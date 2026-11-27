package scada.processing.core.segmentation

import munit.FunSuite
import scada.processing.core.segmentation.Timeline.*

class TimelineSpec extends FunSuite:
  private def run(boundary: Boundary, events: Vector[Event[Long]], initial: Option[Interval[Long]] = None)
      : (Option[Interval[Long]], Vector[Output[Long]]) =
    events.foldLeft((initial, Vector.empty[Output[Long]])):
      case ((open, outputs), event) =>
        val next = Timeline.step(boundary, open, event)
        (next.open, outputs ++ next.outputs)

  test("changing class closes live at the transition and replay at the last sample"):
    val events = Vector(
      Event.Sample(0L, "off", false),
      Event.Sample(1000L, "off", true),
      Event.Sample(2000L, "heat", true),
      Event.Sample(3000L, "heat", true)
    )
    val (liveOpen, live) = run(Boundary.Live, events)
    val (replayOpen, replay) = run(Boundary.Observed, events)
    assertEquals(live.collect { case Output.Closed(row) => row }, Vector(Interval("off", 0L, 2000L)))
    assertEquals(replay.collect { case Output.Closed(row) => row }, Vector(Interval("off", 0L, 1000L)))
    assertEquals(liveOpen, Some(Interval("heat", 2000L, 3000L)))
    assertEquals(replayOpen, liveOpen)

  test("a telemetry gap splits equal classes without filling the gap"):
    val events = Vector(Event.Sample(0L, "off", false), Event.Sample(1000L, "off", true), Event.Sample(4000L, "off", false))
    for boundary <- Boundary.values do
      assertEquals(run(boundary, events), (
        Some(Interval("off", 4000L, 4000L)),
        Vector(
          Output.Pending(Interval("off", 0L, 0L)),
          Output.Pending(Interval("off", 0L, 1000L)),
          Output.Closed(Interval("off", 0L, 1000L)),
          Output.Pending(Interval("off", 4000L, 4000L))
        )
      ))

  test("resuming after any event preserves ordered outputs and exact coordinates"):
    val events = Vector(
      Event.Sample(1000000L, "off", false),
      Event.Sample(1000000L, "heat", true),
      Event.DeadlineExpired(1000000L),
      Event.Sample(1000001L, "heat", true),
      Event.DeadlineExpired(1000042L),
      Event.EndOfInput
    )
    val expected = (
      Some(Interval("heat", 1000000L, 1000001L)),
      Vector(
        Output.Pending(Interval("off", 1000000L, 1000000L)),
        Output.Closed(Interval("off", 1000000L, 1000000L)),
        Output.Pending(Interval("heat", 1000000L, 1000000L)),
        Output.Pending(Interval("heat", 1000000L, 1000001L))
      )
    )
    for boundary <- Boundary.values do
      assertEquals(run(boundary, events), expected)
      for index <- 0 to events.size do
        val (before, after) = events.splitAt(index)
        val (checkpoint, emitted) = run(boundary, before)
        val (open, remaining) = run(boundary, after, checkpoint)
        assertEquals((open, emitted ++ remaining), expected, s"boundary=$boundary, checkpoint=$index")
