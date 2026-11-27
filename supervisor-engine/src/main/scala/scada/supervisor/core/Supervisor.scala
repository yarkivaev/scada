package scada.supervisor.core

import cats.effect.Async
import cats.syntax.all.*
import fs2.Stream
import scala.concurrent.duration.*

/**
 * Per-machine processing loop. Takes readings in, emits
 * [[TaggedSegment]]s through a [[Segments]] collection as each
 * segment opens and closes.
 *
 * The outbound stream is supplied by the caller so the supervisor
 * stays transport-agnostic (live MQTT, replay, or test feed all plug
 * in through the same `readings` parameter).
 *
 * A restored pending island is written before live readings. While that
 * island stays open, a one-second pulse advances `end` so a silent
 * machine still heartbeats the tape instead of leaving a hole until now.
 *
 * {{{
 * Supervisor[F](segmentation, tagging, segments).run(machine, readings, None)
 * }}}
 */
final class Supervisor[F[_]: Async](
    segmentation: Segmentation[F],
    tagging: Tagging,
    segments: Segments[F],
    phases: CyclePhases = CyclePhases.empty,
    customRun: Option[(MachineConfig, Stream[F, Reading], Segments[F]) => F[Unit]] = None
):
  def run(machine: MachineConfig, readings: Stream[F, Reading], initial: Option[SegmentCursor] = None): F[Unit] =
    if machine.mode.isDefined then
      customRun.getOrElse(throw IllegalStateException("Machine mode has no configured runner"))(machine,readings,segments)
    else
      val classified = readings
        .through(segmentation.flow(machine, initial))
        .evalMap(emission => write(machine, tagging.resolve(machine.tags, emission.value)))
      val beats = Stream.awakeEvery[F](1.second).evalMap(_ => pulse(machine)).drain
      open(machine, initial) *> classified.mergeHaltL(beats).compile.drain

  private def open(machine: MachineConfig, initial: Option[SegmentCursor]): F[Unit] =
    initial.fold(Async[F].unit): cursor =>
      write(machine, TaggedSegment(Segment(cursor.name, cursor.start, cursor.end, 0.0), Nil, Nil, Map.empty))

  private def pulse(machine: MachineConfig): F[Unit] =
    segments.list(machine.id).flatMap: rows =>
      Async[F].realTime.map(_.toMillis).flatMap: millis =>
        val now = Timestamp(millis.toDouble / 1000.0)
        val open = rows.filter(_.segment.duration == 0).sortBy(_.segment.start.epoch).lastOption
        open.fold(cover(machine, rows, now))(tagged => extend(machine, tagged, now))

  private def extend(machine: MachineConfig, tagged: TaggedSegment, now: Timestamp): F[Unit] =
    if now.isAfter(tagged.segment.end) then write(machine, tagged.copy(segment = tagged.segment.copy(end = now)))
    else Async[F].unit

  private def cover(machine: MachineConfig, rows: List[TaggedSegment], now: Timestamp): F[Unit] =
    rows.sortBy(_.segment.end.epoch).lastOption.fold(Async[F].unit): last =>
      if !now.isAfter(last.segment.end) then Async[F].unit
      else write(machine, TaggedSegment(Segment(last.segment.name, last.segment.end, now, 0.0), Nil, Nil, Map.empty))

  private def write(machine: MachineConfig, tagged: TaggedSegment): F[Unit] =
    if phases.isEmpty then segments.upsert(machine.id, tagged)
    else
      segments.list(machine.id).flatMap: all =>
        segments.upsert(machine.id, phases.narrow(tagged, all))
