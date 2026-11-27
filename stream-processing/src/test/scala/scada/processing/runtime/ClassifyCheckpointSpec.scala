package scada.processing.runtime

import io.yarkivaev.segmentation.{Condition, SegmentDef}
import cats.effect.{IO, Ref}
import fs2.Stream
import io.yarkivaev.temporal.Observation
import munit.CatsEffectSuite
import scada.processing.core.{MachineConfig, MachineId}
final class ClassifyCheckpointSpec extends CatsEffectSuite:
  for url <- sys.env.get("SCADA_STREAM_WORKER_TEST_JDBC") do
    test("AMQP takeover restores the queued write before acknowledging the retried input"):
      val xa = doobie.Transactor.fromDriverManager[IO]("org.postgresql.Driver", url,
        sys.env.getOrElse("PGUSER", sys.props("user.name")), sys.env.getOrElse("PGPASSWORD", ""), None)
      val machine = MachineConfig(MachineId(java.util.UUID.randomUUID().toString),
        List(SegmentDef("hot", Condition.Above("power", 10))), Nil, 15)
      val point = Observation("immutable-observation", "power", 1000, 42)
      for
        ack <- Ref.of[IO, Int](0)
        deliveries <- Ref.of[IO, Int](0)
        first <- ClassifyStreams.open(machine, Vector.empty,
          ClassifyPorts(_ => IO.unit, (_, _) => IO.raiseError(RuntimeException("writer unavailable"))),
          database = Some(WorkerDatabase(xa, 8)))
        failure <- first.consumeDurable(Stream.emit(point -> ack.update(_ + 1))).compile.drain.attempt
        before <- ack.get
        second <- ClassifyStreams.open(machine, Vector.empty, ClassifyPorts(_ => IO.unit, (_, _) => deliveries.update(_ + 1)),
          database = Some(WorkerDatabase(xa, 9)))
        _ <- second.consumeDurable(Stream.emit(point -> ack.update(_ + 1))).compile.drain
        after <- ack.get
        published <- deliveries.get
      yield
        assert(failure.isLeft)
        assertEquals(before, 0)
        assertEquals(after, 1)
        assertEquals(published, 1)
