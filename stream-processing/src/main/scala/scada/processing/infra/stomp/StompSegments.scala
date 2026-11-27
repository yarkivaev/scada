package scada.processing.infra.stomp

import io.yarkivaev.segmentation.{Segment, SplitFollow, TaggedSegment, Timestamp}
import cats.Monad
import cats.effect.IO
import cats.syntax.all.*
import io.circe.Json
import io.circe.syntax.*
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.processing.core.*
import scada.processing.core.Segments as CoreSegments
import scada.processing.runtime.{HistoryHttpError, TimelineWriter}
import scala.collection.concurrent.TrieMap
import scala.concurrent.duration.*

/**
 * STOMP-publishing decorator over a [[CoreSegments]]. Every write
 * (upsert, replace, resolve) is forwarded to `underlying` and then
 * announced on `destination` using the [[SegmentMessage]] JSON
 * contract.
 *
 * Pending heartbeats (`duration == 0`) are published at most once per
 * `heartbeat` interval per `(machine, start)` key so shovel traffic
 * does not overwhelm central ingest. Open, close, retag, and split
 * announcements are never delayed.
 *
 * {{{
 * StompSegments(base, connection, "/exchange/segments")
 * StompSegments(base, connection, "/exchange/segments", 1.second)
 * }}}
 */
final class StompSegments(
    underlying: CoreSegments[IO],
    connection: StompSender,
    destination: String,
    heartbeat: FiniteDuration = 1.second,
    nowMillis: IO[Long] = IO.realTime.map(_.toMillis),
    private val stamps: TrieMap[(String, Long), Long] = TrieMap.empty,
    policy: SegmentWirePolicy = SegmentWirePolicy.default
) extends CoreSegments[IO]:

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  override def atRevision[A](machine: MachineId)(action: IO[A]): IO[A] =
    connection match
      case sink: TimelineWriter => sink.atRevision(machine.raw)(action)
      case _ => action

  def upsert(machine: MachineId, segment: TaggedSegment): IO[Unit] = atRevision(machine):
    underlying.upsert(machine, segment) *>
      underlying.list(machine).flatMap: rows =>
        SplitFollow.affected(segment, rows) match
          case Some(tail) => announce(machine, tail)
          case None =>
            underlying.find(machine, segment.segment.start).flatMap:
              case None      => announce(machine, segment)
              case Some(seg) => announce(machine, seg)

  override def upsertTransition(machine: MachineId, rows: List[TaggedSegment])(using Monad[IO]): IO[Unit] = atRevision(machine):
    if !policy.atomicTransition || rows.size < 2 then super.upsertTransition(machine, rows)
    else
      val body = Json.obj("type" -> "phase-transition".asJson, "machine" -> machine.raw.asJson,
        "pieces" -> rows.map(row => SegmentMessage.segment(machine,row).jsonWith(policy)).asJson)
      rows.traverse_(underlying.upsert(machine, _)) *> publishRaw(body.noSpaces, true)

  def find(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]] =
    underlying.find(machine, start)

  def list(machine: MachineId): IO[List[TaggedSegment]] =
    underlying.list(machine)

  def replace(machine: MachineId, from: Timestamp, to: Timestamp, segments: List[TaggedSegment]): IO[Unit] = atRevision(machine):
    underlying.replace(machine, from, to, segments) *>
      (if segments.isEmpty then IO.unit
       else publishRaw(SplitFamily.json(machine, from, segments)))

  def resolve(
      machine: MachineId,
      original: Segment,
      tags: List[String],
      options: List[String],
      properties: Map[String, String]
  ): IO[Unit] = atRevision(machine):
    underlying.resolve(machine, original, tags, options, properties) *>
      underlying.find(machine, original.start).flatMap:
        case None      => IO.unit
        case Some(seg) => publish(SegmentMessage.retag(machine, seg))

  private def announce(machine: MachineId, segment: TaggedSegment): IO[Unit] =
    val message = publish(SegmentMessage.segment(machine, segment))
    val output = if policy.splitBeforeSegment(segment) then publish(SegmentMessage.split(machine, segment)) *> message else message
    if segment.segment.duration != 0.0 then
      stamps.remove((machine.raw, segment.segment.start.millis))
      output
    else if policy.bypassHeartbeatThrottle(segment) then output
    else throttle(machine, segment.segment.start, output)

  private def throttle(machine: MachineId, start: Timestamp, publishIo: IO[Unit]): IO[Unit] =
    val key = (machine.raw, start.millis)
    nowMillis.flatMap: now =>
      stamps.get(key) match
        case Some(last) if now - last < heartbeat.toMillis => IO.unit
        case _ =>
          IO.delay { stamps.update(key, now) } *> publishIo

  private def publish(message: SegmentMessage): IO[Unit] =
    publishRaw(message.jsonWith(policy).noSpaces, policy.confirmed(message.segment))

  private def publishRaw(body: String, confirmed: Boolean = false): IO[Unit] =
    val frame = StompFrame.send(destination,"",body)
    val sent = if confirmed then frame.copy(headers=frame.headers.updated("receipt",java.util.UUID.randomUUID().toString)) else frame
    retrying(connection.send(sent),3,100.millis)

  private def retrying[A](io: IO[A], attempts: Int, delay: FiniteDuration): IO[A] =
    io.handleErrorWith:
      case error: HistoryHttpError if error.status >= 400 && error.status < 500 => IO.raiseError(error)
      case error if attempts <= 1 =>
        Logger[IO].error(error)(s"timeline publish failed after all retries on $destination") *>
          IO.raiseError(error)
      case error =>
        Logger[IO].warn(error)(s"timeline publish retry in ${delay.toMillis}ms on $destination") *>
          IO.sleep(delay) *> retrying(io, attempts - 1, delay * 2)
