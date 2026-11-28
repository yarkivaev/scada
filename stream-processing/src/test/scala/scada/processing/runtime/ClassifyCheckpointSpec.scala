package scada.processing.runtime

import io.yarkivaev.segmentation.{Condition, SegmentDef}
import cats.effect.{IO, Ref}
import fs2.Stream
import doobie.implicits.*
import io.yarkivaev.temporal.Observation
import io.circe.Json
import munit.CatsEffectSuite
import scada.processing.core.{MachineConfig, MachineId}
final class ClassifyCheckpointSpec extends CatsEffectSuite:
  for url <- sys.env.get("SCADA_STREAM_WORKER_TEST_JDBC") do
    test("AMQP takeover restores a queued write from an older checkpoint before acknowledging input"):
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
        // The old AMQP command stored the routed point without its precomputed publication.
        changed <- sql"""
          UPDATE stream_worker_checkpoint
          SET document = document #- '{pendingOutputs,0,value,publication}'
          WHERE task_id = ${machine.id.raw} AND input_id = 'amqp-classify' AND run_id = 'live'
        """.update.run.transact(xa)
        second <- ClassifyStreams.open(machine, Vector.empty, ClassifyPorts(_ => IO.unit, (_, _) => deliveries.update(_ + 1)),
          database = Some(WorkerDatabase(xa, 9)))
        _ <- second.consumeDurable(Stream.emit(point -> ack.update(_ + 1))).compile.drain
        after <- ack.get
        published <- deliveries.get
      yield
        assert(failure.isLeft)
        assertEquals(before, 0)
        assertEquals(changed, 1)
        assertEquals(after, 1)
        assertEquals(published, 1)

    test("takeover keeps the approved wire rows when the live watermark changes"):
      val xa = doobie.Transactor.fromDriverManager[IO]("org.postgresql.Driver", url,
        sys.env.getOrElse("PGUSER", sys.props("user.name")), sys.env.getOrElse("PGPASSWORD", ""), None)
      val id = MachineId(java.util.UUID.randomUUID().toString)
      val config = machine.copy(id = id)
      for
        attempts <- Ref.of[IO, List[(Vector[Json], Boolean)]](Nil)
        first <- ClassifyStreams.open(config, Vector.empty,
          ClassifyPorts(_ => IO.unit, (rows, late) =>
            attempts.update(_ :+ (rows -> late)) *> IO.raiseError(RuntimeException("missing broker receipt"))),
          database = Some(WorkerDatabase(xa, 1)))
        failed <- first.accept(point).attempt
        second <- ClassifyStreams.open(config, Vector.empty,
          ClassifyPorts(_ => IO.unit, (rows, late) => attempts.update(_ :+ (rows -> late)), admit = (_, _) => false),
          watermark = Some(1000000L), database = Some(WorkerDatabase(xa, 2)))
        _ <- second.accept(point)
        sent <- attempts.get
      yield
        assert(failed.isLeft)
        assertEquals(sent.size, 2)
        assertEquals(sent(1), sent.head)
        assert(!sent.head._2)

  private val machine = MachineConfig(MachineId("history-machine"),
    List(SegmentDef("hot", Condition.Above("power", 10))), Nil, 15)
  private val point = Observation("point-1", "power", 1000, 42)

  private def retry(firstFailure: Throwable, expected: List[Option[String]]): IO[Unit] =
    for
      revision <- Ref.of[IO, String]("10")
      attempts <- Ref.of[IO, List[Option[String]]](Nil)
      acknowledged <- Ref.of[IO, Int](0)
      ports = ClassifyPorts(_ => IO.unit, (_, _) => IO.unit,
        timeline = (_, _) => revision.get.map(value => Some(TimelineSnapshot(value, Vector.empty))),
        atRevision = (value, write) => attempts.getAndUpdate(_ :+ value).flatMap:
          case Nil => revision.set("11") *> IO.raiseError(firstFailure)
          case _ => write)
      classifier <- ClassifyStreams.open(machine, Vector.empty, ports)
      input = Stream.emit(point -> acknowledged.update(_ + 1))
      first <- classifier.consumeDurable(input).compile.drain.attempt
      before <- acknowledged.get
      _ <- classifier.consumeDurable(input).compile.drain
      after <- acknowledged.get
      planned <- attempts.get
    yield
      assertEquals(first, Left(firstFailure))
      assertEquals(before, 0)
      assertEquals(after, 1)
      assertEquals(planned, expected)

  test("lost publication acknowledgement retries the frozen timeline plan"):
    retry(RuntimeException("missing broker receipt"), List(Some("10"), Some("10")))

  test("a definite revision conflict discards the plan before reprocessing the unacknowledged input"):
    retry(HistoryHttpError("/v1/history/live-apply", 409, Some("REVISION_CONFLICT")), List(Some("10"), Some("11")))
