package scada.supervisor.runtime

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.supervisor.infra.config.{AliasMapping, AppConfig, CheckpointApiConfig}
import scada.supervisor.infra.stomp.{ClassifyQueue, StompFrame, StompSender}
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
final class HistoryRun(runtime: SupervisorRuntime, profile: RuntimeProfile):
  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  /** Retries until this process is the sole classifier. */
  def gated(config: AppConfig, machine: scada.supervisor.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long = 0L, segmentEndMs: Option[Long] = None): Stream[IO, Unit] =
    if !config.leaseHeld then Stream.never[IO]
    else
      val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
      config.leaseUrl match
        case None if machine.mode.isDefined && !ObservationLead.ready(observationMs, segmentEndMs, leader) =>
          Stream.exec(Logger[IO].info(s"classifier waiting for telemetry on ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds) ++ gated(config, machine, aliases, sender, api, observationMs, segmentEndMs)
        case None => follow(config, machine, aliases, sender, api, observationMs, segmentEndMs)
        case Some(url) => once(url, config, machine, aliases, sender, api) ++ Stream.eval(IO.unit).flatMap(_ => gated(config, machine, aliases, sender, api, observationMs, segmentEndMs))

  private def once(url: String, config: AppConfig, machine: scada.supervisor.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig): Stream[IO, Unit] =
    Stream.resource(WriterLease.open(url, machine.id.raw)).flatMap: hold =>
      if !hold.held then Stream.exec(Logger[IO].info(s"classifier lease denied for ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds)
      else Stream.eval(hold.seed(machine.id.raw)).flatMap: (end, rows) =>
        val grant = hold.generation.map(value => LeaseGrant(true, value))
        if machine.mode.isDefined then follow(config, machine, aliases, sender, api, end.getOrElse(0L), end, grant)
        else Stream.eval(IO.blocking(ClassifierCursors.load(hold.connection, machine.id.raw, machine.window.toLong * 2000, 10000))).flatMap: pool =>
          amqp(config, machine, aliases, sender, rows, end, grant, p => IO.blocking(ClassifierCursors.save(hold.connection, machine.id.raw, p)), Some(pool))

  private def follow(config: AppConfig, machine: scada.supervisor.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long, segmentEndMs: Option[Long], grant: Option[LeaseGrant] = None): Stream[IO, Unit] =
    if machine.mode.isEmpty then amqp(config, machine, aliases, sender, Vector.empty, segmentEndMs, grant)
    else if !ObservationLead.ready(observationMs, segmentEndMs, ObservationLead.leading(config.writerRole, config.leaseUrl)) then
      Stream.exec(Logger[IO].info(s"classifier waiting for telemetry on ${machine.id.raw}")) ++ Stream.sleep_[IO](5.seconds)
    else custom(config, machine, aliases, sender, api, observationMs, segmentEndMs, grant)

  private def custom(config: AppConfig, machine: scada.supervisor.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], api: CheckpointApiConfig, observationMs: Long, segmentEndMs: Option[Long], grant: Option[LeaseGrant] = None): Stream[IO, Unit] =
    val announce = runtime.leadAnnounce(sender, config, machine.id, observationMs, segmentEndMs, grant)
    profile.history(machine, aliases, api, announce)

  private def amqp(config: AppConfig, machine: scada.supervisor.core.MachineConfig, aliases: List[AliasMapping], sender: Option[StompSender], seed: Vector[Json], segmentEndMs: Option[Long], grant: Option[LeaseGrant], persist: HistoryPool => IO[Unit] = _ => IO.unit, initial: Option[HistoryPool] = None): Stream[IO, Unit] =
    val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
    val publish = runtime.historyAnnounce(sender, config, machine.id, grant)
    val queue = s"scada.classify.${machine.id.raw}"
    val input = ClassifyQueue(config.connectivity.rabbitmq, queue, aliases).subscribe
    val ports = ClassifyPorts(persist, (rows, historical) => ClassifyBus.publish(sender, config, segmentEndMs, leader, publish, historical)(rows))
    Stream.eval(Logger[IO].info(s"consuming AMQP classify queue $queue")) >> Stream.eval(ClassifyStreams.open(machine, seed, ports, segmentEndMs, initial)).flatMap(_.consume(input))

/**
 * Sends committed classify rows. Split-family bodies stay raw JSON.
 *
 * {{{
 * ClassifyBus.publish(sender, config, None, true, announce)(rows)
 * }}}
 */
object ClassifyBus:
  def publish(sender: Option[StompSender], config: AppConfig, segmentEndMs: Option[Long], leader: Boolean, announce: Vector[Json] => IO[Unit], historical: Boolean = false)(rows: Vector[Json]): IO[Unit] =
    val dest = config.connectivity.rabbitmq.destinations.segments
    val families = rows.filter(_.hcursor.get[String]("type").toOption.contains("split-family"))
    val segments = rows.filterNot(_.hcursor.get[String]("type").toOption.contains("split-family"))
    val obs = ClassifyBus.horizon(rows)
    if !historical && !ObservationLead.ready(obs, segmentEndMs, leader) then IO.unit
    else
      val outbound = if sender.isEmpty then rows else segments
      announce(outbound) *> ((sender, dest) match
        case (Some(conn), Some(path)) => families.traverse_(row => conn.send(StompFrame.send(path, "", row.noSpaces)))
        case _ => IO.unit)
  private def horizon(rows: Vector[Json]): Long =
    val ends = rows.flatMap: row =>
      row.hcursor.get[String]("end_time").toOption.map(java.time.Instant.parse(_).toEpochMilli).toVector ++
        row.hcursor.downField("pieces").as[Vector[Json]].toOption.getOrElse(Vector.empty).flatMap(_.hcursor.get[Long]("end").toOption)
    ends.maxOption.getOrElse(0L)
