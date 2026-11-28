package scada.processing.runtime

import cats.effect.{IO, Ref}
import io.yarkivaev.streamworker.{Checkpoint, Output, OutputId, ProcessorVersion, TaskIdentity}
import munit.CatsEffectSuite

final class WorkerStoresSpec extends CatsEffectSuite:
  private val version = ProcessorVersion("test/1", "rules", "state/1")

  test("a failed journal write leaves the receipt position available for retry"):
    val task = TaskIdentity("machine-test", "input", "live")
    val start = Checkpoint[Int, String](task, version, 0L, None, 0, Vector.empty)
    val next = start.copy(revision = 1L, position = Some(1L), state = 1)
    for
      attempts <- Ref.of[IO, Int](0)
      binding <- WorkerStores.local(start)(saved => attempts.getAndUpdate(_ + 1).flatMap: attempt =>
        IO.raiseWhen(attempt == 0)(IllegalStateException(s"Could not persist revision ${saved.revision}")))
      failure <- binding.store.commit(binding.ownership, 0L, next).attempt
      unchanged <- binding.store.load(task, binding.ownership)
      _ <- binding.store.commit(binding.ownership, 0L, next)
      committed <- binding.store.load(task, binding.ownership)
    yield
      assert(failure.isLeft)
      assertEquals(unchanged, start)
      assertEquals(committed, next)

  for url <- sys.env.get("SCADA_STREAM_WORKER_TEST_JDBC") do
    test("a database takeover reconciles the processor state and preserves pending output identity"):
      val xa = doobie.Transactor.fromDriverManager[IO]("org.postgresql.Driver", url,
        sys.env.getOrElse("PGUSER", sys.props("user.name")), sys.env.getOrElse("PGPASSWORD", ""), None)
      val task = TaskIdentity(java.util.UUID.randomUUID().toString, "input", "live")
      val output = Output(OutputId(task, 7L, 0), "pending")
      val start = Checkpoint(task, version, 0L, Some(7L), 1, Vector(output))
      for
        first <- WorkerStores.database(WorkerDatabase(xa, 7), start)(_ => None)
        second <- WorkerStores.database(WorkerDatabase(xa, 8), start)(state => Some(state + 1))
        stale <- first.store.load(task, first.ownership).attempt
        saved <- second.store.load(task, second.ownership)
      yield
        assert(stale.isLeft)
        assertEquals(saved.state, 2)
        assertEquals(saved.position, Some(7L))
        assertEquals(saved.pendingOutputs, Vector(output))
