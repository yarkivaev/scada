package scada.processing.runtime

import io.yarkivaev.segmentation.{Segment, TaggedSegment, Timestamp}
import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json
import io.circe.parser.parse
import java.time.Instant
import scada.processing.core.*
import scada.processing.infra.config.AppConfig
import scada.processing.infra.stomp.{SegmentMessage, StompFrame, StompSender}

/**
 * Publishes a committed local-history page to the segment exchange.
 * Local ingest is unbound, so the already stored row is not written again.
 *
 * {{{
 * HistoryBus.message(MachineId("machine-1"), row)
 * HistoryBus.publish(sender, "/exchange/scada.segments", MachineId("machine-1"))(rows)
 * HistoryBus.publish(sender, "/exchange/scada.segments", MachineId("machine-1"), Some(7L))(rows)
 * }}}
 */
object HistoryBus:
  /** Bus envelope for one committed row, with start and end kept as exact epoch millis. */
  def message(machine: MachineId, row: Json): Json =
    val cursor = row.hcursor
    val name = required(cursor, "name")
    val start = Instant.parse(required(cursor, "start_time")).toEpochMilli
    val end = Instant.parse(required(cursor, "end_time")).toEpochMilli
    val duration = cursor.get[Double]("duration").getOrElse(0.0)
    val tagged = TaggedSegment(
      Segment(name, Timestamp(start / 1000.0), Timestamp(end / 1000.0), duration),
      strings(cursor.downField("tags").focus.getOrElse(Json.Null)),
      strings(cursor.downField("options").focus.getOrElse(Json.Null)),
      props(cursor.downField("properties").focus.getOrElse(Json.Null))
    )
    SegmentMessage.segment(machine, tagged).json.deepMerge(Json.obj(
      "start" -> Json.fromLong(start),
      "end" -> Json.fromLong(end),
      "kind" -> Json.fromString(cursor.get[String]("kind").getOrElse("phase"))
    ))

  /** Same envelope plus the etcd writer epoch receivers use to keep one writer. */
  def stamped(machine: MachineId, row: Json, epoch: Long): Json =
    require(WriterEpoch.accept(epoch, epoch), s"Writer epoch must be positive, message $epoch")
    message(machine, row).deepMerge(Json.obj("epoch" -> Json.fromLong(epoch)))

  /** Sends every committed row. An empty page sends nothing. */
  def publish(sender: StompSender, destination: String, machine: MachineId)(rows: Vector[Json]): IO[Unit] =
    publish(sender, destination, machine, None)(rows)

  /** Sends every committed row and stamps the writer epoch when one is supplied. */
  def publish(sender: StompSender, destination: String, machine: MachineId, epoch: Option[Long])(rows: Vector[Json]): IO[Unit] =
    rows.traverse_ { row =>
      val body = epoch.fold(message(machine, row))(n => stamped(machine, row, n))
      val committed = body.deepMerge(Json.obj("committedOutputId" -> Json.fromString(TimelineWriter.identity(None, body))))
      sender.send(StompFrame.send(destination, "", committed.noSpaces))
    }

  /** Sends a committed page. A configured lease uses the holder generation and a non-holder sends nothing. */
  private[runtime] def announce(sender: Option[StompSender], config: AppConfig, machine: MachineId, grant: Option[LeaseGrant] = None): Vector[io.circe.Json] => IO[Unit] =
    WriterLease.publication(config.leaseUrl, grant, config.writerEpoch) match
      case None => (_: Vector[io.circe.Json]) => IO.unit
      case Some(epoch) =>
        (sender, config.connectivity.rabbitmq.destinations.segments) match
          case (Some(conn), Some(dest)) => HistoryBus.publish(conn, dest, machine, epoch)
          case _ => (_: Vector[io.circe.Json]) => IO.unit

  /**
   * Publishes committed history only after a real segment end is covered.
   * A leader may publish when nothing has been replicated. A standby does not.
   * A configured lease stamps its generation and a process that does not hold it does not publish.
   * The same gate covers every configured machine.
   *
   * {{{
   * HistoryBus.lead(sender, config, MachineId("machine-1"), 5L, Some(4L), Some(LeaseGrant(true, 7)))(rows)
   * }}}
   */
  private[runtime] def lead(
      sender: Option[StompSender],
      config: AppConfig,
      machine: MachineId,
      observationMs: Long,
      segmentEndMs: Option[Long],
      grant: Option[LeaseGrant] = None
  ): Vector[io.circe.Json] => IO[Unit] =
    val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
    if config.leaseHeld && ObservationLead.ready(observationMs, segmentEndMs, leader) then announce(sender, config, machine, grant)
    else (_: Vector[io.circe.Json]) => IO.unit

  private def required(cursor: io.circe.HCursor, key: String): String =
    cursor.get[String](key).fold(error => throw IllegalArgumentException(s"History segment missing $key: ${error.getMessage}"), identity)

  private def strings(value: Json): List[String] =
    val parsed = value.asString.flatMap(text => parse(text).toOption).getOrElse(value)
    parsed.asArray.fold(List.empty[String])(_.flatMap(_.asString).toList)

  private def props(value: Json): Map[String, String] =
    val parsed = value.asString.flatMap(text => parse(text).toOption).getOrElse(value)
    parsed.asObject.fold(Map.empty[String, String])(_.toIterable.flatMap((key, item) => item.asString.map(key -> _)).toMap)
