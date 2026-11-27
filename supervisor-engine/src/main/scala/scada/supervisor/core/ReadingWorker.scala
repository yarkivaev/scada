package scada.supervisor.core

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import scada.stream.worker.*
import scada.supervisor.core.segmentation.Timeline.Interval
import scala.concurrent.duration.*

/** Assembles the MQTT session input and its segment output port. */
final class ReadingWorker(
    segmentation: Segmentation[IO],
    tagging: Tagging,
    segments: Segments[IO],
    phases: CyclePhases = CyclePhases.empty,
    customRun: Option[(MachineConfig, Stream[IO, Reading], Segments[IO]) => IO[Unit]] = None,
    outputs: Option[OutputScope] = None
):
  import ReadingWorker.*

  private val processor = new Processor[MachineConfig, State, Input, TaggedSegment]:
    def step(machine: MachineConfig, state: State, input: Input): Either[ProcessingError, StepResult[State, TaggedSegment]] =
      input match
        case Input.Sample(reading) =>
          segmentation.step(machine, state, reading).map(result =>
            StepResult(result.state, result.outputs.map(emission => tagging.resolve(machine.tags, emission.value))))
        case Input.Restore(cursor) =>
          Right(StepResult(state, Vector(pending(cursor.name, cursor.start, cursor.end))))
        case Input.Pulse(now, rows) =>
          Right(StepResult(state, pulse(now, rows).toVector))

  def run(machine: MachineConfig, readings: Stream[IO, Reading], initial: Option[SegmentCursor] = None): IO[Unit] =
    if machine.mode.isDefined then
      customRun.fold(IO.raiseError(IllegalStateException("Machine mode has no configured worker")))(_(machine, readings, segments))
    else
      for
        id <- IO.randomUUID
        task = TaskIdentity(machine.id.raw, "mqtt", id.toString)
        // MQTT reseeds from the timeline checkpoint rather than replaying a stable broker position.
        snapshot = Checkpoint[State, TaggedSegment](task, mqttVersion, 0, None, segmentation.seed(initial), Vector.empty)
        store <- CheckpointStore.session(snapshot, 1)
        worker = StreamWorker(processor, store, (_, row) =>
          outputs.fold(write(machine, row.value))(_.within(row.id)(write(machine, row.value))))
        _ <- worker.run(task, mqttVersion, machine, 1): _ =>
          val samples = segmentation.gather(readings).map(reading => IO.pure(Input.Sample(reading)))
          val beats = Stream.awakeEvery[IO](1.second).as(for
            rows <- segments.list(machine.id)
            now <- IO.realTime.map(value => Timestamp(value.toMillis.toDouble / 1000.0))
          yield Input.Pulse(now, rows))
          val restore = Stream.emits(initial.toList).map(cursor => IO.pure(Input.Restore(cursor)))
          (restore ++ samples.mergeHaltL(beats)).evalMap(identity).zipWithIndex.map: (input, position) =>
            Delivery(position, input, IO.unit)
      yield ()

  private def write(machine: MachineConfig, tagged: TaggedSegment): IO[Unit] = segments.atRevision(machine.id):
    if phases.isEmpty then segments.upsert(machine.id, tagged)
    else segments.list(machine.id).flatMap(all => segments.upsert(machine.id, phases.narrow(tagged, all)))

object ReadingWorker:
  private type State = Option[Interval[Reading]]
  private val mqttVersion = ProcessorVersion("mqtt-segments/1", "session", "timeline/1")

  private enum Input:
    case Sample(reading: Reading)
    case Restore(cursor: SegmentCursor)
    case Pulse(now: Timestamp, rows: List[TaggedSegment])

  private def pending(name: String, start: Timestamp, end: Timestamp): TaggedSegment =
    TaggedSegment(Segment(name, start, end, 0.0), Nil, Nil, Map.empty)

  private def pulse(now: Timestamp, rows: List[TaggedSegment]): Option[TaggedSegment] =
    rows.filter(_.segment.duration == 0).maxByOption(_.segment.start) match
      case Some(open) =>
        Option.when(now.isAfter(open.segment.end))(open.copy(segment = open.segment.copy(end = now)))
      case None =>
        rows.maxByOption(_.segment.end).filter(last => now.isAfter(last.segment.end))
          .map(last => pending(last.segment.name, last.segment.end, now))
