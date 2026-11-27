package scada.supervisor.runtime

import cats.effect.{ExitCode, IO, IOApp, Ref, Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import fs2.Stream
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.supervisor.core.{
  Decision,
  MachineConfig,
  MachineId,
  Reading,
  Segmentation,
  Segments as CoreSegments,
  Supervisor,
  TagDef,
  TaggedSegment,
  Timestamp
}
import scada.supervisor.infra.checkpoint.{Checkpoint, ClickhouseReadingsCheckpoint, SupervisorSinkCheckpoint}
import scada.supervisor.infra.config.{AliasMapping, AppConfig, ConfigLoad, RabbitMqConfig}
import scada.supervisor.infra.mqtt.Mqtt
import scada.supervisor.infra.state.{CheckpointSegments, Segments as StateSegments}
import scada.supervisor.infra.stomp.{DurableStomp, StompConnection, StompDecisions, StompSegments, StompSender}
import scala.collection.immutable.SortedMap
import scala.concurrent.duration.*

/**
 * Live entry point and composition root. Loads HOCON, wires the
 * module graph, opens the startup ceremony (checkpoint API replay, live
 * MQTT, STOMP decisions) and runs every per-machine supervisor loop
 * concurrently with the decision consumer until killed.
 *
 * `F` is pinned to `IO` here; `core` stays tagless.
 *
 * Decorator order:
 * {{{
 * StompSegments(CheckpointSegments(StateSegments(...), checkpoint), connection, dest)
 * }}}
 * Segment persistence/publish remains the durable boundary. Replay
 * cursor is derived from supervisor-sink checkpoint API during startup.
 *
 * {{{
 * sbt "runMain scada.supervisor.runtime.EngineApp config/application.conf"
 * }}}
 */
open class SupervisorRuntime(profile: RuntimeProfile) extends IOApp:

  private val defaultPath: String = "config/application.conf"

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  def run(args: List[String]): IO[ExitCode] =
    args match
      case "--capabilities" :: Nil => IO.println(io.circe.Json.obj("role" -> io.circe.Json.fromString("supervisor"),
        "historyProtocols" -> io.circe.Json.arr(profile.historyProtocols.map(io.circe.Json.fromString)*)).noSpaces).as(ExitCode.Success)
      case "--check" :: path :: Nil => ConfigLoad(profile = profile.configuration).load(path).as(ExitCode.Success)
      case "--check" :: _ => IO.raiseError(IllegalArgumentException("Usage: supervisor --check CONFIG"))
      case _ => ConfigLoad(profile = profile.configuration).load(args.headOption.getOrElse(defaultPath)).flatMap(live).as(ExitCode.Success)

  private def live(config: AppConfig): IO[Unit] =
    Logger[IO].info(s"supervisor starting: machines=${config.machines.size} stomp=${config.connectivity.rabbitmq.destinations.segments.isDefined} checkpointApi=${config.connectivity.checkpointApi.isDefined}") *>
      Ref.of[IO, Map[MachineId, SortedMap[Timestamp, TaggedSegment]]](Map.empty).flatMap: segmentsRef =>
        resources(config).use: publishConn =>
          val checkpoint = checkpointWithDecorators(config)
          val base       = StateSegments[IO](segmentsRef, profile.statePolicy)
          val withFallback = checkpoint.fold(base)(cp => CheckpointSegments(base, cp))
          val decorated  = decorate(config, publishConn, withFallback)
          profile.decorate(config, decorated).flatMap(runStreams(config, _, checkpoint, base, publishConn))

  private def runStreams(config: AppConfig, segments: CoreSegments[IO], checkpoint: Option[Checkpoint], base: StateSegments[IO], publish: Option[StompSender]): IO[Unit] =

    val supervisor = Supervisor[IO](Segmentation[IO](profile.classifyReading), profile.tagging, segments, config.cyclePhases)
    val decisionSegments = checkpoint.filter(_ => config.localHistory).fold(segments)(cp =>
      CheckpointSegments(segments,cp,preferCheckpoint=true,refreshCache=Some(base.refresh)))
    val stall = config.connectivity.checkpointApi.map(api => api.timeoutSeconds.seconds).getOrElse(60.seconds)
    val seeding = checkpoint.map(Seeding(_, config.seeding.capacity, stall))
    val protectedMachines = Orphans.protectedMachines(config) ++ config.machines.filter(_.mode.isDefined).map(_.id)
    val canCloseOrphans = config.leaseHeld && config.machines.exists(machine => !protectedMachines(machine.id))
    Logger[IO].info("supervisor ready, closing orphaned pending segments") *>
      closeWhenHeld(canCloseOrphans, checkpoint, segments, protectedMachines) *>
      Logger[IO].info("supervisor ready, entering stream loop") *>
      (if config.machines.isEmpty then IO.never
       else streams(config, supervisor, decisionSegments, seeding, checkpoint, publish, segments).compile.drain) *>
      Logger[IO].info("supervisor stream loop exited")
  /**
   * Closes orphan pending rows only while this process holds the writer lease.
   *
   * {{{
   * SupervisorRuntime.closeWhenHeld(false, checkpoint, segments, Set.empty)
   * }}}
   */
  private[runtime] def closeWhenHeld(held: Boolean, checkpoint: Option[Checkpoint], segments: CoreSegments[IO], historical: Set[MachineId]): IO[Unit] =
    if held then closeOrphanPending(checkpoint, segments, historical) else IO.unit

  private def closeOrphanPending(checkpoint: Option[Checkpoint], segments: CoreSegments[IO], historical: Set[MachineId]): IO[Unit] =
    checkpoint match
      case None => IO.unit
      case Some(cp) =>
        cp.fetchPendingSegments.flatMap: rows =>
          val xs = Orphans.list(rows,historical)
          (if xs.nonEmpty then
             Logger[IO].info(s"closing ${xs.length} orphaned pending segment rows at startup")
           else IO.unit) *>
            xs.traverse_(row => Close.run(segments, row))

  private def checkpointWithDecorators(config: AppConfig): Option[Checkpoint] =
    val base = config.connectivity.checkpointApi.map(SupervisorSinkCheckpoint(_))
    (config.seeding.useClickhouseReadings, base, config.connectivity.clickhouseReadings) match
      case (true, Some(cp), Some(ch)) => Some(ClickhouseReadingsCheckpoint(cp, ch))
      case _                          => base

  private def resources(
      config: AppConfig
  ): Resource[IO, Option[StompSender]] =
    for
      publish <- stompConnection(config.connectivity.rabbitmq)
      _       <- HealthServer().serve(config.health.port)
    yield publish

  private def stompConnection(rabbit: RabbitMqConfig): Resource[IO, Option[StompSender]] =
    rabbit.destinations.segments.fold(Resource.pure[IO, Option[StompSender]](None)): _ =>
      Resource.eval((Ref.of[IO, Option[StompSender]](None),Semaphore[IO](1)).tupled).map: (slot,lock) =>
        val durable = DurableStomp(
            StompConnection.connect(
              rabbit.address.host,
              rabbit.address.port,
              rabbit.vhost,
              rabbit.credentials.login,
              rabbit.credentials.passcode
            ),
            3,
            slot
          )
        Some(new StompSender:
          def send(frame: scada.supervisor.infra.stomp.StompFrame): IO[Unit] = lock.permit.use(_ => durable.send(frame))
        )

  private def decorate(
      config: AppConfig,
      publish: Option[StompSender],
      base: CoreSegments[IO]
  ): CoreSegments[IO] =
    (publish, config.connectivity.rabbitmq.destinations.segments) match
      case (Some(conn), Some(dest)) => StompSegments(base, conn, dest, policy = profile.wirePolicy)
      case _                        => base

  private def streams(
      config: AppConfig,
      supervisor: Supervisor[IO],
      segments: CoreSegments[IO],
      seeding: Option[Seeding],
      checkpoint: Option[Checkpoint],
      publish: Option[StompSender],
      profileSegments: CoreSegments[IO]
  ): Stream[IO, Unit] =
    Stream(machineStreams(config, supervisor, seeding, checkpoint, publish, profileSegments = Some(profileSegments))*).parJoinUnbounded
      .concurrently(decisionStream(config, segments))
      .concurrently(profile.decisions(config, segments))

  /** Sends a committed page. A configured lease uses the holder generation and a non-holder sends nothing. */
  private[runtime] def historyAnnounce(sender: Option[StompSender], config: AppConfig, machine: MachineId, grant: Option[LeaseGrant] = None): Vector[io.circe.Json] => IO[Unit] =
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
   * SupervisorRuntime.leadAnnounce(sender, config, MachineId("machine-1"), 5L, Some(4L), Some(LeaseGrant(true, 7)))(rows)
   * }}}
   */
  private[runtime] def leadAnnounce(
      sender: Option[StompSender],
      config: AppConfig,
      machine: MachineId,
      observationMs: Long,
      segmentEndMs: Option[Long],
      grant: Option[LeaseGrant] = None
  ): Vector[io.circe.Json] => IO[Unit] =
    val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
    if config.leaseHeld && ObservationLead.ready(observationMs, segmentEndMs, leader) then historyAnnounce(sender, config, machine, grant)
    else (_: Vector[io.circe.Json]) => IO.unit

  /**
   * Sources can replay checkpoint readings
   * after the cursor, then continue with the live subscription.
   *
   * {{{
   * SupervisorRuntime.sourced(machine, aliases, live, seeding)
   * }}}
   */
  private[runtime] def sourced(
      machine: MachineConfig,
      aliases: List[AliasMapping],
      live: Stream[IO, Reading],
      seeding: Option[Seeding]
  ): Stream[IO, Reading] =
    seeding.fold(live)(_.seed(machine, aliases, live))

  /** Holds one classifier per machine. The loser waits and tries the same lock again. */
  private def lease(url: Option[String], machine: String, leader: Boolean, body: Stream[IO, Unit]): Stream[IO, Unit] =
    url match
      case None => body
      case Some(value) =>
        val attempt = Stream.resource(WriterLease.open(value, machine)).flatMap: hold =>
          Stream.eval(if hold.held && !leader then hold.ready(machine, false).map(_.isDefined) else IO.pure(false)).flatMap: caught =>
            if WriterGate.admit(hold.held, leader, caught) then body
            else
              val reason = if hold.held then s"classifier waiting for telemetry on $machine" else s"classifier lease denied for $machine"
              Stream.exec(Logger[IO].info(reason)) ++ Stream.sleep_[IO](5.seconds)
        attempt.repeat

  private[runtime] def machineStreams(
      config: AppConfig,
      supervisor: Supervisor[IO],
      seeding: Option[Seeding],
      checkpoint: Option[Checkpoint],
      sender: Option[StompSender] = None,
      observationMs: Long = 0L,
      segmentEndMs: Option[Long] = None,
      profileSegments: Option[CoreSegments[IO]] = None
  ): List[Stream[IO, Unit]] =
    config.machines.map: machine =>
      val aliases  = config.routing.aliases.getOrElse(machine.id, Nil)
      val mqttCfg  = config.connectivity.mqtt.copy(clientId = s"${config.connectivity.mqtt.clientId}-${machine.id.raw}")
      val leader = ObservationLead.leading(config.writerRole, config.leaseUrl)
      config.connectivity.checkpointApi match
        case _ if !config.leaseHeld =>
          Stream.exec(Logger[IO].info(s"classifier lease unheld for ${machine.id.raw}")) ++ Stream.never[IO]
        case Some(_) if config.localHistory && config.leaseUrl.isEmpty && !ObservationLead.ready(observationMs, segmentEndMs, leader) =>
          Stream.never[IO]
        case Some(api) if config.localHistory =>
          HistoryRun(this, profile).gated(config, machine, aliases, sender, api, observationMs, segmentEndMs)
        case _ =>
          val body = profileSegments.flatMap(profile.live(config, machine, aliases, _, checkpoint, seeding)).getOrElse:
            val live = Mqtt(mqttCfg, aliases).subscribe
            val readings = sourced(machine, aliases, live, seeding)
            Stream.eval(if machine.mode.isDefined then IO.pure(None) else PendingIsland.resolve(checkpoint, machine)).flatMap: initial =>
              Stream.eval(supervisor.run(machine, readings, initial))
          lease(config.leaseUrl, machine.id.raw, leader, body)

  private[runtime] def heed(decision: Decision, segments: CoreSegments[IO], tagDefs: List[TagDef]): IO[Unit] =
    decision.applyTo(segments, tagDefs, profile.tagging).handleErrorWith:
      case _: IllegalArgumentException => IO.unit
      case error => IO.raiseError(error)

  private def decisionStream(config: AppConfig, segments: CoreSegments[IO]): Stream[IO, Unit] =
    val byMachine = config.machines.map(m => m.id -> m).toMap
    StompDecisions(config.connectivity.rabbitmq).subscribe.evalMap: decision =>
      val machine = decision match
        case Decision.Resolve(id, _, _, _) => byMachine.get(id)
        case Decision.Split(id, _, _) => byMachine.get(id)
        case _ => None
      machine.flatMap(_.mode) match
        case Some(_) => IO.unit
        case None => heed(decision, segments, machine.fold(List.empty[TagDef])(_.tags))
