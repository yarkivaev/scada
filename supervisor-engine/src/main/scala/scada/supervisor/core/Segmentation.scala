package scada.supervisor.core

import cats.effect.Async
import fs2.{Pipe, Stream}
import scala.concurrent.duration.*
import scada.supervisor.core.segmentation.Timeline
import scada.supervisor.core.segmentation.Timeline.{Boundary, Event, Interval, Output}

final case class ReadingOverride(name: String, properties: Map[String, String])

/** Merges same-time readings and applies the live interval policy.
  * Class changes close at the next phase's first sample. A gap over twice
  * the machine's window splits equal phases without inventing downtime.
  */
final class Segmentation[F[_]: Async](overrideReading: Reading => Option[ReadingOverride] = _ => None):
  private val unclassified = "unclassified"

  def flow(machine: MachineConfig, initial: Option[SegmentCursor] = None): Pipe[F, Reading, Emission[Segment]] =
    val classify = Timeline.classifier(machine.segments)
    val maxGap = machine.window.toDouble * 2.0
    val seed = initial.map: cursor =>
      Interval(cursor.name, Reading(cursor.start, Params(Map.empty)), Reading(cursor.end, Params(Map.empty)))

    input =>
      gather(input).mapAccumulate(seed): (open, reading) =>
        val name = overrideReading(reading).map(_.name).orElse(classify(reading.params))
          .orElse(open.map(_.name)).getOrElse(unclassified)
        val continuous = open.exists(interval => !(reading.timestamp.minus(interval.end.timestamp) > maxGap))
        val step = Timeline.step(Boundary.Live, open, Event.Sample(reading, name, continuous))
        (step.open, step.outputs.flatMap(toEmission))
      .flatMap((_, emissions) => Stream.emits(emissions))

  private def gather(in: Stream[F, Reading]): Stream[F, Reading] =
    in.groupWithin(32, 50.millis).flatMap: chunk =>
      Stream.emits:
        chunk.toList.groupBy(_.timestamp.epoch).toList.sortBy(_._1).map: (_, rows) =>
          rows.reduce((left, right) => Reading(right.timestamp, left.params.merge(right.params)))

  private def toEmission(output: Output[Reading]): Option[Emission[Segment]] =
    def segment(interval: Interval[Reading], closed: Boolean): Segment =
      val start = interval.start.timestamp
      val end = interval.end.timestamp
      val duration = if closed then end.minus(start) else 0.0
      val properties = overrideReading(interval.end).fold(Map.empty[String, String])(_.properties)
      Segment(interval.name, start, end, duration, properties)

    output match
      case Output.Pending(interval) if interval.name != unclassified =>
        Some(Emission.Started(segment(interval, closed = false)))
      case Output.Closed(interval) if interval.name != unclassified =>
        Some(Emission.Emitted(segment(interval, closed = true)))
      case _ => None
