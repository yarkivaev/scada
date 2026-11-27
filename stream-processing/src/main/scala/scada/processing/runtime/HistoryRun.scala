package scada.processing.runtime

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.processing.infra.config.{AliasMapping, AppConfig, CheckpointApiConfig}
import scada.processing.infra.stomp.{ClassifyQueue, StompSender}
import scala.concurrent.duration.*

/**
 * Starts classification from AMQP `scada.classify.{machine}`.
 * Site modes can use a durable HTTP work queue. A holder stamps the
 * lease generation. A missing generation does not publish.
 *
 * {{{
 * HistoryRun.gated(config, machine, aliases, sender, api)
 * }}}
 */
final class HistoryRun(profile: RuntimeProfile, writer: Option[TimelineWriter],
    observe: (String, Option[Long]) => Resource[IO, Unit],
    decisions: (AppConfig, scada.processing.core.MachineConfig) => Stream[IO, Unit]):
  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  /** Retries until this process is the sole classifier. */
  def gated(config: AppConfig, machine: scada.processing.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long = 0L, segmentEndMs: Option[Long] = None): Stream[IO, Unit] =
    if !config.leaseHeld then Stream.never[IO]
    else
      val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
      config.leaseUrl match
        case None if machine.mode.isDefined && !ObservationLead.ready(observationMs, segmentEndMs, leader) =>
          Stream.exec(Logger[IO].info(s"classifier waiting for telemetry on ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds) ++ gated(config, machine, aliases, sender, api, observationMs, segmentEndMs)
        case None => follow(config, machine, aliases, sender, api, observationMs, segmentEndMs).concurrently(decisions(config, machine))
        case Some(url) => once(url, config, machine, aliases, sender, api) ++ Stream.eval(IO.unit).flatMap(_ => gated(config, machine, aliases, sender, api, observationMs, segmentEndMs))

  private def once(url: String, config: AppConfig, machine: scada.processing.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig): Stream[IO, Unit] =
    Stream.resource(WriterLease.open(url, machine.id.raw)).flatMap: hold =>
      if !hold.held then Stream.exec(Logger[IO].info(s"classifier lease denied for ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds)
      else Stream.resource(observe(machine.id.raw, hold.generation)) >> Stream.eval(hold.seed(machine.id.raw)).flatMap: (end, rows) =>
        val grant = hold.generation.map(value => LeaseGrant(true, value))
        if machine.mode.isDefined then follow(config, machine, aliases, sender, api, end.getOrElse(0L), end, grant).concurrently(decisions(config, machine))
        else
          val database = hold.generation.map(token =>
            WorkerDatabase(doobie.Transactor.fromConnection[IO](hold.connection, None), token))
          amqp(config, machine, aliases, rows, end, grant, database)

  private def follow(config: AppConfig, machine: scada.processing.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long, segmentEndMs: Option[Long], grant: Option[LeaseGrant] = None): Stream[IO, Unit] =
    if machine.mode.isEmpty then amqp(config, machine, aliases, Vector.empty, segmentEndMs, grant)
    else if !ObservationLead.ready(observationMs, segmentEndMs, ObservationLead.leading(config.writerRole, config.leaseUrl)) then
      Stream.exec(Logger[IO].info(s"classifier waiting for telemetry on ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds)
    else custom(config, machine, aliases, sender, api, observationMs, segmentEndMs, grant)

  private def custom(config: AppConfig, machine: scada.processing.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long, segmentEndMs: Option[Long], grant: Option[LeaseGrant] = None): Stream[IO, Unit] =
    val announce = HistoryBus.lead(sender, config, machine.id, observationMs, segmentEndMs, grant)
    profile.history(machine, aliases, api, announce, grant.filter(_.held).map(_.generation))

  private def amqp(config: AppConfig, machine: scada.processing.core.MachineConfig,
      aliases: List[AliasMapping], seed: Vector[Json], segmentEndMs: Option[Long],
      grant: Option[LeaseGrant], database: Option[WorkerDatabase] = None): Stream[IO, Unit] =
    val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
    val queue = s"scada.classify.${machine.id.raw}"
    val input = ClassifyQueue(config.connectivity.rabbitmq, queue, aliases).subscribeDurable
    val write = writer.getOrElse(throw IllegalStateException("Historical classification requires a timeline writer"))
    val owner = grant.filter(_.held).map(_.generation)
    val ports = ClassifyPorts(_ => IO.unit, (rows, historical) =>
      ClassifyBus.publish(segmentEndMs, leader, historical)(rows): approved =>
        approved.traverse_ { row =>
          val message = if row.hcursor.get[String]("type").contains("split-family") then row else HistoryBus.message(machine.id, row)
          write.applyMessage(machine.id.raw, message, TimelineWriter.identity(None, message), owner,
            config.connectivity.rabbitmq.destinations.segments)
        }
    )
    Stream.eval(Logger[IO].info(s"consuming AMQP classify queue $queue")) >> Stream.eval(ClassifyStreams.open(machine, seed, ports, segmentEndMs, database)).flatMap(_.consumeDurable(input))

object ClassifyBus:
  def publish(segmentEndMs: Option[Long], leader: Boolean, historical: Boolean = false)(rows: Vector[Json])(
      write: Vector[Json] => IO[Unit]
  ): IO[Unit] =
    if historical || ObservationLead.ready(horizon(rows), segmentEndMs, leader) then write(rows)
    else IO.unit

  private def horizon(rows: Vector[Json]): Long =
    val ends = rows.flatMap: row =>
      row.hcursor.get[String]("end_time").toOption.map(java.time.Instant.parse(_).toEpochMilli).toVector ++
        row.hcursor.downField("pieces").as[Vector[Json]].toOption.getOrElse(Vector.empty).flatMap(_.hcursor.get[Long]("end").toOption)
    ends.maxOption.getOrElse(0L)
