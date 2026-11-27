package scada.stream.worker

import cats.effect.IO
import cats.syntax.all.*
import doobie.Transactor
import fs2.Stream
import munit.CatsEffectSuite
import scada.stream.worker.postgres.{CheckpointConflict, PgCheckpointStore}

final class PgCheckpointStoreSpec extends CatsEffectSuite:
  for url <- sys.env.get("SCADA_STREAM_WORKER_TEST_JDBC") do
    test("takeover fences writes, keeps the durable outbox and rejects concurrent revisions"):
      val task = TaskIdentity(java.util.UUID.randomUUID().toString, "readings", "live")
      val version = ProcessorVersion("sum/1", "rules/1", "int/1")
      val initial = Checkpoint[Int, Int](task, version, 0, None, 0, Vector.empty)
      val xa = Transactor.fromDriverManager[IO](
        "org.postgresql.Driver", url,
        sys.env.getOrElse("PGUSER", sys.props("user.name")), sys.env.getOrElse("PGPASSWORD", ""), None
      )
      val store = new PgCheckpointStore[Int, Int](xa)
      val source = (_: Option[Long]) => Stream.emit(Delivery(42, 6, IO.unit))
      val processor = new Processor[Unit, Int, Int, Int]:
        def step(config: Unit, state: Int, event: Int): Either[ProcessingError, StepResult[Int, Int]] =
          Right(StepResult(state + event, Vector(event)))
      val failing = new StreamWorker(processor, store,
        (_, _) => IO.raiseError(new RuntimeException("delivery interrupted")))
      for
        _ <- store.claim(7L, initial)
        interrupted <- failing.run(task, version, (), 7)(source).attempt
        stored <- store.load(task, 7)
        _ <- store.claim(8L, initial)
        alternative = new PgCheckpointStore[String, String](xa)
        incompatible <- alternative.loadCompatible(task, version.copy(stateSchema = "string/1"), 8).attempt
        oldLoad <- store.load(task, 7).attempt
        oldClaim <- store.claim(7L, initial).attempt
        oldWrite <- store.commit(7L, stored.revision, stored.copy(revision = stored.revision + 1)).attempt
        replacement = new StreamWorker(processor, store, (token, row) => IO {
          assertEquals(token, 8L)
          assertEquals(row.id, OutputId(task, 42L, 0))
        })
        recovered <- replacement.run(task, version, (), 8)(source)
        first = recovered.copy(revision = recovered.revision + 1)
        outcomes <- List.fill(2)(store.commit(8, recovered.revision, first).attempt).parSequence
      yield
        assert(interrupted.isLeft)
        assertEquals(stored.state, 6)
        assertEquals(stored.pendingOutputs.map(_.value), Vector(6))
        assert(incompatible.left.toOption.exists(_.isInstanceOf[IncompatibleCheckpoint]))
        assert(oldLoad.left.toOption.exists(_.isInstanceOf[StaleOwnership]))
        assert(oldClaim.left.toOption.exists(_.isInstanceOf[StaleOwnership]))
        assert(oldWrite.left.toOption.exists(_.isInstanceOf[StaleOwnership]))
        assertEquals(recovered.pendingOutputs, Vector.empty)
        assertEquals(recovered.state, 6)
        assertEquals(outcomes.count(_.isRight), 1)
        assertEquals(outcomes.count(_.left.toOption.exists(_.isInstanceOf[CheckpointConflict])), 1)
