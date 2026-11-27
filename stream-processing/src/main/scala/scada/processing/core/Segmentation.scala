package scada.processing.core

import io.yarkivaev.streamworker.{ProcessingError, Processor, StepResult}
import scada.processing.core.segmentation.Timeline
import scada.processing.core.segmentation.Timeline.{Boundary, Event, Interval, Output}

final case class ReadingOverride(name: String, properties: Map[String, String])

/** Merges same-time readings and applies the live interval policy.
  * Class changes close at the next phase's first sample. A gap over twice
  * the machine's window splits equal phases without inventing downtime.
  */
final class Segmentation(overrideReading: Reading => Option[ReadingOverride] = _ => None)
    extends Processor[MachineConfig, Option[Interval[Reading]], Reading, Emission[Segment]]:
  private val unclassified = "unclassified"

  private[processing] def seed(initial: Option[SegmentCursor]): Option[Interval[Reading]] =
    initial.map: cursor =>
      Interval(cursor.name, Reading(cursor.start, Params(Map.empty)), Reading(cursor.end, Params(Map.empty)))

  override def step(machine: MachineConfig, open: Option[Interval[Reading]], reading: Reading)
      : Either[ProcessingError, StepResult[Option[Interval[Reading]], Emission[Segment]]] =
    Right(advance(machine, open, reading))

  private def advance(machine: MachineConfig, open: Option[Interval[Reading]], reading: Reading)
      : StepResult[Option[Interval[Reading]], Emission[Segment]] =
    val classify = Timeline.classifier(machine.segments)
    val name = overrideReading(reading).map(_.name).orElse(classify(reading.params))
      .orElse(open.map(_.name)).getOrElse(unclassified)
    val continuous = open.exists(interval => !(reading.timestamp.minus(interval.end.timestamp) > machine.window.toDouble * 2.0))
    val result = Timeline.step(Boundary.Live, open, Event.Sample(reading, name, continuous))
    StepResult(result.open, result.outputs.flatMap(toEmission))

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
