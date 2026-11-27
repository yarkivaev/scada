package scada.supervisor.core

import munit.CatsEffectSuite
import scada.stream.worker.Processor
import scada.supervisor.core.segmentation.Timeline.Interval

final class ReadingWorkerSpec extends CatsEffectSuite:
  test("live segmentation is directly usable as a deterministic stream processor"):
    val machine = MachineConfig(MachineId("worker"), Nil, Nil, 15)
    val processor: Processor[MachineConfig, Option[Interval[Reading]], Reading, Emission[Segment]] =
      Segmentation[cats.effect.IO](_ => Some(ReadingOverride("on", Map("source" -> "input"))))
    val input = Reading(Timestamp(100), Params(Map.empty))
    val result = processor.step(machine, None, input)
    assertEquals(result, processor.step(machine, None, input))
    assertEquals(result.toOption.toList.flatMap(_.outputs.map(_.value)),
      List(Segment("on", Timestamp(100), Timestamp(100), 0, Map("source" -> "input"))))
