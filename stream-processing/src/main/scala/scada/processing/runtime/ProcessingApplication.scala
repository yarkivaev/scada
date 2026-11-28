package scada.processing.runtime

import io.yarkivaev.segmentation.{Reading, Segmentation, TagDef, TaggedSegment, Timestamp}
import cats.effect.{ExitCode, IO, Ref, Resource}
import cats.effect.std.Semaphore
import cats.syntax.all.*
import fs2.Stream
import io.yarkivaev.streamworker.OutputScope
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.processing.core.{Decision, MachineConfig, MachineId, Segments as CoreSegments, ReadingWorker}
import scada.processing.infra.checkpoint.{Checkpoint, ClickhouseReadingsCheckpoint, SupervisorSinkCheckpoint}
import scada.processing.infra.config.{AliasMapping, AppConfig, ConfigLoad, RabbitMqConfig}
import scada.processing.infra.mqtt.Mqtt
import scada.processing.infra.state.{CheckpointSegments, Segments as StateSegments}
import scada.processing.infra.stomp.{DurableStomp, StompConnection, StompDecisions, StompSegments, StompSender}
import scala.collection.immutable.SortedMap
import scala.concurrent.duration.*

/** Wires broker inputs, task ownership, processing jobs and timeline output adapters. */
final class ProcessingApplication(profile: RuntimeProfile):
  private val defaultPath: String = "config/application.conf"

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  def run(args: List[String]): IO[ExitCode] =
    args match
      case "--capabilities" :: Nil => IO.println(io.circe.Json.obj("role" -> io.circe.Json.fromString("supervisor"),
        "historyProtocols" -> io.circe.Json.arr(profile.historyProtocols.map(io.circe.Json.fromString)*)).noSpaces).as(ExitCode.Success)
      case "--check" :: path :: Nil => load(path).as(ExitCode.Success)
      case "--check" :: _ => IO.raiseError(IllegalArgumentException("Usage: supervisor --check CONFIG"))
      case _ => load(args.headOption.getOrElse(defaultPath)).flatMap(live).as(ExitCode.Success)

  private def load(path: String): IO[AppConfig] =
    ConfigLoad(profile = profile.configuration).load(path).flatMap: config =>
      val outputEnabled = config.connectivity.rabbitmq.destinations.segments.isDefined
      IO.raiseWhen(outputEnabled && config.connectivity.checkpointApi.isEmpty)(
        IllegalArgumentException("A timeline sink checkpoint API is required when segment output is enabled")
      ).as(config)

  private def live(config: AppConfig): IO[Unit] =
    Logger[IO].info(s"supervisor starting: machines=${config.machines.size} stomp=${config.connectivity.rabbitmq.destinations.segments.isDefined} checkpointApi=${config.connectivity.checkpointApi.isDefined}") *>
      Ref.of[IO, Map[MachineId, SortedMap[Timestamp, TaggedSegment]]](Map.empty).flatMap: segmentsRef =>
        (for
          owners <- Resource.eval(Ref.of[IO, Map[String, Long]](Map.empty))
          outputs <- Resource.eval(OutputScope.create)
          publish <- resources(config)
          writer <- Resource.eval(timelineWriter(config, owners, outputs, publish))
        yield (owners, outputs, publish, writer)).use: (owners, outputs, publishConn, writer) =>
          val checkpoint = checkpointWithDecorators(config)
          val base       = StateSegments[IO](segmentsRef, profile.statePolicy)
          val withFallback = checkpoint.fold(base)(cp => CheckpointSegments(base, cp))
          val decorated  = decorate(config, writer, withFallback)
          profile.decorate(config, decorated).flatMap(runStreams(config, _, checkpoint, base, publishConn, writer, owners, outputs))

  private def runStreams(config: AppConfig, segments: CoreSegments[IO], checkpoint: Option[Checkpoint], base: StateSegments[IO], publish: Option[StompSender], writer: Option[TimelineWriter],
      owners: Ref[IO, Map[String, Long]], outputs: OutputScope): IO[Unit] =

    val worker = ReadingWorker(Segmentation(profile.classifyReading), profile.tagging, segments, config.cyclePhases, outputs = Some(outputs))
    val decisionSegments = checkpoint.filter(_ => config.localHistory).fold(segments)(cp =>
      CheckpointSegments(segments,cp,preferCheckpoint=true,refreshCache=Some(base.refresh)))
    val stall = config.connectivity.checkpointApi.map(api => api.timeoutSeconds.seconds).getOrElse(60.seconds)
    val seeding = checkpoint.map(Seeding(_, config.seeding.capacity, stall))
    val protectedMachines = Orphans.protectedMachines(config) ++ config.machines.filter(_.mode.isDefined).map(_.id)
    val canCloseOrphans = config.leaseUrl.isEmpty && config.leaseHeld && config.machines.exists(machine => !protectedMachines(machine.id))
    Logger[IO].info("supervisor ready, closing orphaned pending segments") *>
      closeWhenHeld(canCloseOrphans, checkpoint, segments, protectedMachines) *>
      Logger[IO].info("supervisor ready, entering stream loop") *>
      (if config.machines.isEmpty then IO.never
       else streams(config, worker, decisionSegments, seeding, checkpoint, publish, segments, writer, owners, outputs).compile.drain) *>
      Logger[IO].info("supervisor stream loop exited")
  /**
   * Closes orphan pending rows only while this process holds the writer lease.
   *
   * {{{
   * ProcessingApplication.closeWhenHeld(false, checkpoint, segments, Set.empty)
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
          def send(frame: scada.processing.infra.stomp.StompFrame): IO[Unit] = lock.permit.use(_ => durable.send(frame))
        )

  private def timelineWriter(config: AppConfig, owners: Ref[IO, Map[String, Long]], outputs: OutputScope,
      publish: Option[StompSender]): IO[Option[TimelineWriter]] =
    config.connectivity.checkpointApi.traverse: api =>
      val owner = (machine: String) => owners.get.flatMap: current =>
        val grant = current.get(machine)
        IO.raiseWhen(config.leaseUrl.isDefined && grant.isEmpty)(
          IllegalStateException(s"No active timeline writer for $machine")).as(grant)
      TimelineWriter.create(HistoryClient(api), owner, outputs, publish)

  private def track(owners: Ref[IO, Map[String, Long]])(machine: String, generation: Option[Long]): Resource[IO, Unit] =
    generation.fold(Resource.unit[IO])(value => Resource.make(owners.update(_.updated(machine, value)))(_ =>
      owners.update(current => if current.get(machine).contains(value) then current.removed(machine) else current)))

  private def decorate(
      config: AppConfig,
      writer: Option[TimelineWriter],
      base: CoreSegments[IO]
  ): CoreSegments[IO] =
    (writer, config.connectivity.rabbitmq.destinations.segments) match
      case (Some(sink), Some(dest)) => StompSegments(base, sink, dest, policy = profile.wirePolicy)
      case _                        => base

  private def streams(
      config: AppConfig,
      worker: ReadingWorker,
      segments: CoreSegments[IO],
      seeding: Option[Seeding],
      checkpoint: Option[Checkpoint],
      publish: Option[StompSender],
      profileSegments: CoreSegments[IO],
      writer: Option[TimelineWriter],
      owners: Ref[IO, Map[String, Long]],
      outputs: OutputScope
  ): Stream[IO, Unit] =
    Stream(machineStreams(config, worker, seeding, checkpoint, publish, profileSegments = Some(profileSegments), writer = writer, observe = track(owners), outputs = Some(outputs),
      decisionSegments = Some(segments))*).parJoinUnbounded
      .concurrently(decisionStream(config, segments, owners))

  /**
   * Sources can replay checkpoint readings
   * after the cursor, then continue with the live subscription.
   *
   * {{{
   * ProcessingApplication.sourced(machine, aliases, live, seeding)
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
  private def lease(url: Option[String], machine: String, leader: Boolean,
      observe: (String, Option[Long]) => Resource[IO, Unit], body: Option[WorkerDatabase] => Stream[IO, Unit]): Stream[IO, Unit] =
    url match
      case None => body(None)
      case Some(value) =>
        val attempt = Stream.resource(WriterLease.open(value, machine)).flatMap: hold =>
          Stream.eval(if hold.held && !leader then hold.ready(machine, false).map(_.isDefined) else IO.pure(false)).flatMap: caught =>
            if WriterGate.admit(hold.held, leader, caught) then
              val database = hold.generation.map(token =>
                WorkerDatabase(doobie.Transactor.fromConnection[IO](hold.connection, None), token))
              Stream.resource(observe(machine, hold.generation)) >> body(database)
            else
              val reason = if hold.held then s"classifier waiting for telemetry on $machine" else s"classifier lease denied for $machine"
              Stream.exec(Logger[IO].info(reason)) ++ Stream.sleep_[IO](5.seconds)
        attempt.repeat

  private[runtime] def machineStreams(
      config: AppConfig,
      worker: ReadingWorker,
      seeding: Option[Seeding],
      checkpoint: Option[Checkpoint],
      sender: Option[StompSender] = None,
      observationMs: Long = 0L,
      segmentEndMs: Option[Long] = None,
      profileSegments: Option[CoreSegments[IO]] = None,
      writer: Option[TimelineWriter] = None,
      observe: (String, Option[Long]) => Resource[IO, Unit] = (_, _) => Resource.unit[IO],
      outputs: Option[OutputScope] = None,
      decisionSegments: Option[CoreSegments[IO]] = None
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
          HistoryRun(profile, writer, observe,
            (settings, source) => decisionSegments.fold(Stream.empty.covaryAll[IO, Unit])(
              profile.decisions(settings, source, _))
          ).gated(config, machine, aliases, api, observationMs, segmentEndMs)
        case _ =>
          val body = (database: Option[WorkerDatabase]) =>
            profileSegments.flatMap(profile.live(config, machine, aliases, _, checkpoint, seeding, outputs, database)).getOrElse:
              val live = Mqtt(mqttCfg, aliases).subscribe
              val readings = sourced(machine, aliases, live, seeding)
              Stream.eval(if machine.mode.isDefined then IO.pure(None) else PendingIsland.resolve(checkpoint, machine)).flatMap: initial =>
                Stream.eval(worker.run(machine, readings, initial))
          val prepare = profileSegments.filter(_ => config.leaseUrl.nonEmpty && machine.mode.isEmpty).fold(IO.unit): segments =>
            checkpoint.fold(IO.unit)(_.fetchPendingSegments.flatMap(rows =>
              Orphans.list(rows.filter(_.machine == machine.id)).traverse_(Close.run(segments, _))))
          lease(config.leaseUrl, machine.id.raw, leader, observe, database => Stream.exec(prepare) ++ body(database))

  private[runtime] def heed(decision: Decision, segments: CoreSegments[IO], tagDefs: List[TagDef]): IO[Unit] =
    val write = decision.applyTo(segments, tagDefs, profile.tagging)
    val scoped = decision match
      case Decision.Resolve(machine, _, _, _) => segments.atRevision(machine)(write)
      case Decision.Split(machine, _, _) => segments.atRevision(machine)(write)
      case Decision.Skip(_) => write
    scoped.handleErrorWith:
      case _: IllegalArgumentException => IO.unit
      case error => IO.raiseError(error)

  private def decisionStream(config: AppConfig, segments: CoreSegments[IO], owners: Ref[IO, Map[String, Long]])
      : Stream[IO, Unit] =
    if !config.leaseHeld then Stream.empty
    else
      val byMachine = config.machines.map(m => m.id -> m).toMap
      StompDecisions(config.connectivity.rabbitmq).subscribe.evalMap: decision =>
        val target = decision match
          case Decision.Resolve(id, _, _, _) => byMachine.get(id)
          case Decision.Split(id, _, _) => byMachine.get(id)
          case Decision.Skip(_) => None
        target.filter(_.mode.isEmpty).fold(IO.unit): machine =>
          owners.get.flatMap(current =>
            IO.whenA(config.leaseUrl.isEmpty || current.contains(machine.id.raw))(heed(decision, segments, machine.tags)))
