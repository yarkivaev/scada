package scada.processing.runtime

import io.yarkivaev.segmentation.{Condition, HistoryRange, HistorySeed, HistorySegment, HistoryState, SegmentDef}
import io.yarkivaev.streamworker.{ProcessingError, Processor, StepResult}
import io.yarkivaev.temporal.Observation
import munit.CatsEffectSuite
import scada.processing.core.{MachineConfig, MachineId}
import scada.processing.infra.config.{RabbitMqConfig, StompAddress, StompCredentials, StompDestinations}
import scala.concurrent.duration.*

final class RabbitHistoryInputSpec extends CatsEffectSuite:
  private val processor = new Processor[Boolean, Int, Int, Int]:
    override def step(rejectNegative: Boolean, state: Int, event: Int): Either[ProcessingError, StepResult[Int, Int]] =
      if rejectNegative && event < 0 then Left(ProcessingError("Rejected negative observation"))
      else
        val total = state + event
        Right(StepResult(total, Vector(total)))

  for port <- sys.env.get("SCADA_HISTORY_TEST_STOMP_PORT") do
    val config = RabbitMqConfig(
      StompAddress("127.0.0.1", port.toInt),
      "/",
      StompCredentials(sys.env.getOrElse("SCADA_HISTORY_TEST_STOMP_LOGIN", "guest"),
        sys.env.getOrElse("SCADA_HISTORY_TEST_STOMP_PASSCODE", "guest")),
      StompDestinations("/queue/unused", None)
    )
    val input = HistoryInput.rabbit(config)

    test("a finite page preserves repeated observations across broker batches"):
      val page = Vector(2, 2, -5, 7) ++ Vector.fill(124)(0) ++ Vector(3, 3)
      input.run(processor, false, 10, page).timeout(15.seconds).map: result =>
        assertEquals(result.state, 22)
        assertEquals(result.outputs, Vector(12, 14, 9, 16) ++ Vector.fill(124)(16) ++ Vector(19, 22))

    test("an empty page preserves its initial state and emits nothing"):
      input.run(processor, false, 10, Vector.empty[Int]).timeout(15.seconds).map: result =>
        assertEquals(result.state, 10)
        assertEquals(result.outputs, Vector.empty[Int])

    test("queued classification retains the seed and exact observed boundaries"):
      val machine = MachineConfig(MachineId("m"),
        List(SegmentDef("heat", Condition.Above("power", 5)), SegmentDef("off", Condition.Below("power", 5))), Nil, 15)
      val start = 9007199254741001L
      val heatAt = start + 32002L
      val seed = HistorySeed(start, Map("power" -> 0.0, "current" -> 5.0),
        Some(HistorySegment("off", start - 1000L, start)))
      val points = Vector(Observation("heat", "power", heatAt, 10), Observation("off", "power", start + 2L, 0))
      val continuity = Vector(HistoryRange(start, heatAt))
      val heat = HistorySegment("heat", heatAt, heatAt)
      LocalHistory.classifyQueued(input, machine, points, Some(seed), continuity).timeout(15.seconds).map: result =>
        assertEquals(result.segments, Vector(HistorySegment("off", start - 1000L, start + 2L), heat))
        assertEquals(result.state, Some(HistoryState(heatAt,
          Map("power" -> (heatAt, 10.0), "current" -> (start, 5.0)), Some(heat))))

    test("after a processor failure the whole page can be submitted again"):
      val page = Vector(2, -5, 7)
      for
        failed <- input.run(processor, true, 10, page).timeout(15.seconds).attempt
        _ = assert(failed.left.toOption.exists(_.getMessage.contains("Rejected negative observation")), failed.toString)
        retried <- input.run(processor, false, 10, page).timeout(15.seconds)
      yield
        assertEquals(retried.state, 14)
        assertEquals(retried.outputs, Vector(12, 7, 14))
