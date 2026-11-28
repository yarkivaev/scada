package scada.processing.runtime

import io.yarkivaev.segmentation.{HistorySegment, HistoryState}
import cats.effect.IO
import cats.effect.std.Semaphore
import cats.syntax.all.*
import fs2.Stream
import io.circe.{Codec, Decoder, Encoder, Json}
import io.circe.generic.semiauto.deriveCodec
import io.yarkivaev.temporal.{Conflict, Cursor, History, LocalStreams, Observation, Work}
import scala.collection.immutable.TreeMap
import java.time.Instant
import io.yarkivaev.streamworker.postgres.PgCheckpointStore
import io.yarkivaev.streamworker.{Checkpoint, CheckpointStore, Delivery, ProcessingError, Processor, ProcessorVersion, StepResult, StreamWorker, TaskIdentity}
import scada.processing.core.MachineConfig

/**
 * Machine AMQP classification with independent event-time cursors.
 * Leased workers checkpoint their active tapes and pending writes in PostgreSQL.
 *
 * {{{
 * ClassifyStreams.start(machine, seed, announce).flatMap(_.accept(point))
 * }}}
 */
final class ClassifyStreams private (
    machine: MachineConfig,
    store: CheckpointStore[StreamState, ClassifyStreams.Command],
    task: TaskIdentity,
    ports: ClassifyPorts,
    watermark: Option[Long],
    lock: Semaphore[IO],
    ownership: Long
):
  import ClassifyStreams.{Command, Publication, version}

  private val processor = new Processor[Unit, StreamState, (Observation, Long, Option[TimelineSnapshot]), Command]:
    override def step(config: Unit, state: StreamState, input: (Observation, Long, Option[TimelineSnapshot]))
        : Either[ProcessingError, StepResult[StreamState, Command]] =
      val (point, now, timeline) = input
      val (next, routed) = ClassifyStreams.route(state, point, now, machine.window.toLong * 2000)
      val publication = Option.when(routed.changed)(prepare(next, routed.cursor, timeline))
      Right(StepResult(next, Vector(Command(point, routed, publication))))

  private val worker = StreamWorker(processor, store, (_, output) =>
    val attempt = output.value.publication.filter(_.admitted).traverse_ { publication =>
      ports.atRevision(publication.revision, ports.announce(publication.rows, publication.historical))
    }
    attempt *> store.load(task, ownership).flatMap(checkpoint => ports.persist(checkpoint.state.pool)))

  def consume(input: Stream[IO, Observation]): Stream[IO, Unit] = input.evalMap(accept)
  def consumeDurable(input: Stream[IO, (Observation, IO[Unit])]): Stream[IO, Unit] =
    input.evalMap((point, acknowledge) => accept(point) *> acknowledge)

  def cursors: IO[Vector[Cursor]] = store.load(task, ownership).map(_.state.pool.cursors.streams)
  def accept(point: Observation): IO[Unit] = lock.permit.use: _ =>
    for
      checkpoint <- store.load(task, ownership)
      now <- ports.clock
      retry = checkpoint.pendingOutputs.exists(_.value.point == point)
      position = checkpoint.position.fold(0L)(previous => if retry then previous else previous + 1L)
      pending = checkpoint.pendingOutputs.find(output => output.value.routed.changed && output.value.publication.isEmpty)
      saved <- pending.traverse: output =>
        val routed = output.value.routed
        capture(checkpoint.state, routed).map(timeline => prepare(checkpoint.state, routed.cursor, timeline))
      _ <- replacePendingPlan(checkpoint, saved, when = _.publication.isEmpty)
      next <- if retry then IO.pure(None)
        else
          val (state, routed) = ClassifyStreams.route(checkpoint.state, point, now, machine.window.toLong * 2000)
          capture(state, routed)
      _ <- worker.run(task, version, (), ownership)(_ => Stream.emit(Delivery(position, (point, now, next), IO.unit)))
        .handleErrorWith:
          case conflict: HistoryHttpError if conflict.code.contains("REVISION_CONFLICT") =>
            store.load(task, ownership).flatMap(replacePendingPlan(_, None, when = _.publication.nonEmpty)) *> IO.raiseError(conflict)
          case failure => IO.raiseError(failure)
    yield ()

  private def replacePendingPlan(
      checkpoint: Checkpoint[StreamState, Command], publication: Option[Publication], when: Command => Boolean
  ): IO[Unit] =
    val pending = checkpoint.pendingOutputs.map: output =>
      if when(output.value) then output.copy(value = output.value.copy(publication = publication)) else output
    IO.whenA(pending != checkpoint.pendingOutputs)(
      store.commit(ownership, checkpoint.revision, checkpoint.copy(revision = checkpoint.revision + 1L, pendingOutputs = pending)))
  private def capture(state: StreamState, routed: RoutedPoint): IO[Option[TimelineSnapshot]] =
    if !routed.changed then IO.pure(None)
    else
      val rows = state.tapes.getOrElse(routed.cursor.id, History.empty).rows
      (rows.headOption, rows.lastOption) match
        case (Some((from, _)), Some((until, _))) => ports.timeline(from, until)
        case _ => IO.pure(None)

  private def prepare(snapshot: StreamState, cursor: Cursor, timeline: Option[TimelineSnapshot]): Publication =
    val points = ClassifyHistory.collected(snapshot.tapes.getOrElse(cursor.id, History.empty))
    val until = points.map(_.time).maxOption.getOrElse(0L)
    val from = points.map(_.time).minOption.getOrElse(0L)
    val slack = machine.window.toLong * 2000
    val historical = watermark.exists(end => cursor.position + slack < end)
    val existing = timeline.fold(snapshot.stored)(_.rows).filter(row => ClassifyStreams.overlaps(row, from, until))
    val result = LocalHistory.classify(machine, points)
    val context = Json.obj("segments" -> Json.arr(existing*), "page" -> Json.obj("until" -> Json.fromLong(until)),
      "rightClosed" -> Json.fromBoolean(historical))
    val rows = ClassifyHistory.published(machine, existing, result, context)
    Publication(timeline.map(_.revision), rows, historical, ports.admit(rows, historical))

final case class TimelineSnapshot(revision: String, rows: Vector[Json])

final case class ClassifyPorts(
    persist: HistoryPool => IO[Unit], announce: (Vector[Json], Boolean) => IO[Unit],
    clock: IO[Long] = IO.realTime.map(_.toMillis),
    timeline: (Long, Long) => IO[Option[TimelineSnapshot]] = (_, _) => IO.pure(None),
    atRevision: (Option[String], IO[Unit]) => IO[Unit] = (_, action) => action,
    admit: (Vector[Json], Boolean) => Boolean = (_, _) => true
)
final case class StreamState(pool: HistoryPool, tapes: Map[Long, History], stored: Vector[Json])
final case class RoutedPoint(cursor: Cursor, changed: Boolean)

object ClassifyStreams:
  private final case class Publication(revision: Option[String], rows: Vector[Json], historical: Boolean, admitted: Boolean)
  private final case class Command(point: Observation, routed: RoutedPoint, publication: Option[Publication])
  private given Codec.AsObject[Cursor] = deriveCodec
  private given Codec.AsObject[Work] = deriveCodec
  private given Codec.AsObject[LocalStreams] = deriveCodec
  private given Codec.AsObject[Observation] = deriveCodec
  private given Codec.AsObject[HistorySegment] = deriveCodec
  private given Codec.AsObject[HistoryState] = deriveCodec
  private given Codec.AsObject[HistoryPool] = deriveCodec
  private given Encoder.AsObject[History] = Encoder.forProduct2("rows", "seen")(value => (value.rows.toMap, value.seen))
  private given Decoder[History] = Decoder.forProduct2("rows", "seen")(
    (rows: Map[Long, Map[String, Observation]], seen: Set[String]) => History(TreeMap.from(rows), seen))
  private given Codec.AsObject[StreamState] = deriveCodec
  private given Codec.AsObject[RoutedPoint] = deriveCodec
  private given Codec.AsObject[Publication] = deriveCodec
  private given Codec.AsObject[Command] = deriveCodec
  private val version = ProcessorVersion("amqp-classify/1", "session", "history-cursors/1")

  def start(machine: MachineConfig, seed: Vector[Json], announce: (Vector[Json], Boolean) => IO[Unit]): IO[ClassifyStreams] =
    open(machine, seed, ClassifyPorts(_ => IO.unit, announce))
  def open(machine: MachineConfig, seed: Vector[Json], ports: ClassifyPorts,
      watermark: Option[Long] = None, database: Option[WorkerDatabase] = None): IO[ClassifyStreams] =
    val pool = HistoryPool(LocalStreams.empty(machine.window.toLong * 2000, 10000), Map.empty)
    val owner = database.fold(1L)(_.generation)
    val run = database.fold(IO.randomUUID.map(_.toString))(_ => IO.pure("live"))
    for
      id <- run
      task = TaskIdentity(machine.id.raw, "amqp-classify", id)
      snapshot = Checkpoint[StreamState, Command](task, version, 0L, None, StreamState(pool, Map.empty, seed), Vector.empty)
      store <- database match
        case Some(db) =>
          val durable = PgCheckpointStore[StreamState, Command](db.transactor)
          durable.claim(owner, snapshot).as(durable)
        case None => CheckpointStore.session(snapshot, owner)
      lock <- Semaphore[IO](1)
    yield new ClassifyStreams(machine, store, task, ports, watermark, lock, owner)
  private[runtime] def route(current: StreamState, point: Observation, now: Long, maxGap: Long): (StreamState, RoutedPoint) =
    val gap = if current.pool.cursors.maxGap > 0 then current.pool.cursors.maxGap else maxGap
    val idle = current.pool.cursors.idleTimeout
    val evicted = current.pool.expire(now)
    val routed = evicted.cursors.copy(maxGap = gap, idleTimeout = idle).route(point, now)
    val kept = routed.state.copy(streams = routed.state.streams.takeRight(64))
    val pool = HistoryPool(kept, evicted.states.filter((id, _) => kept.streams.exists(_.id == id)))
    val history = current.tapes.getOrElse(routed.stream.id, History.empty)
    val next = history.accept(point, Conflict.first)
    val tapes = current.tapes.filter((id, _) => kept.streams.exists(_.id == id)).updated(routed.stream.id, next)
    (StreamState(pool, tapes, current.stored), RoutedPoint(routed.stream, next.rows != history.rows))
  private[runtime] def overlaps(row: Json, from: Long, until: Long): Boolean =
    val start = row.hcursor.get[String]("start_time").toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
    val end = row.hcursor.get[String]("end_time").toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
    start <= until && end >= from
