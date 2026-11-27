package scada.stream.worker

import cats.effect.{IO, Ref}
import fs2.Stream
import munit.CatsEffectSuite

final class StreamWorkerSpec extends CatsEffectSuite:
  private val task = TaskIdentity("sum", "readings", "live")
  private val version = ProcessorVersion("sum/1", "rules/1", "int/1")
  private val processor = new Processor[Int, Int, Int, Int]:
    def step(config: Int, state: Int, event: Int): Either[ProcessingError, StepResult[Int, Int]] =
      val next = state + config * event
      Right(StepResult(next, Vector(next)))

  private def state(initial: Int = 0): Checkpoint[Int, Int] =
    Checkpoint(task, version, 0, None, initial, Vector.empty)

  private def store(checkpoint: Ref[IO, Checkpoint[Int, Int]], owner: Ref[IO, Long]): CheckpointStore[Int, Int] =
    new CheckpointStore[Int, Int]:
      def load(task: TaskIdentity, ownership: Long): IO[Checkpoint[Int, Int]] =
        owner.get.flatMap(value => if value == ownership then checkpoint.get else IO.raiseError(StaleOwnership(task, ownership)))
      def commit(ownership: Long, expectedRevision: Long, next: Checkpoint[Int, Int]): IO[Unit] =
        owner.get.flatMap: value =>
          if value != ownership then IO.raiseError(StaleOwnership(next.task, ownership))
          else checkpoint.modify: current =>
            if current.revision == expectedRevision then (next, Right(()))
            else (current, Left(IllegalStateException("checkpoint revision changed")))
          .flatMap(IO.fromEither)

  test("resume a committed input and preserve output identity across delivery failure and ownership change"):
    for
      checkpoint <- Ref.of[IO, Checkpoint[Int, Int]](state())
      owner <- Ref.of[IO, Long](7L)
      sent <- Ref.of[IO, Vector[Output[Int]]](Vector.empty)
      acked <- Ref.of[IO, Vector[Long]](Vector.empty)
      first = new StreamWorker(processor, store(checkpoint, owner), (_, row) =>
        sent.update(_ :+ row) *> IO.raiseError(new RuntimeException("confirmation lost")))
      input = (position: Long, value: Int) => Delivery(position, value, acked.update(_ :+ position))
      interrupted <- first.run(task, version, 2, 7)(_ => Stream.emit(input(10, 4))).attempt
      saved <- checkpoint.get
      _ <- owner.set(8)
      replacement = new StreamWorker(processor, store(checkpoint, owner), (_, row) => sent.update(_ :+ row))
      restored <- replacement.run(task, version, 2, 8): after =>
        assertEquals(after, Some(10L))
        Stream.emits(Vector(input(10, 4), input(11, 1)))
      published <- sent.get
      confirmed <- acked.get
    yield
      assert(interrupted.isLeft)
      assertEquals(saved.position, Some(10L))
      assertEquals(saved.state, 8)
      assertEquals(saved.pendingOutputs.map(_.value), Vector(8))
      assertEquals(restored.state, 10)
      assertEquals(restored.pendingOutputs, Vector.empty)
      assertEquals(published.map(_.value), Vector(8, 8, 10))
      assertEquals(published(0).id, published(1).id)
      assertNotEquals(published(1).id, published(2).id)
      assertEquals(confirmed, Vector(10L, 10L, 11L))

  test("a stale owner cannot atomically commit or acknowledge a new input"):
    for
      checkpoint <- Ref.of[IO, Checkpoint[Int, Int]](state())
      owner <- Ref.of[IO, Long](7L)
      acked <- Ref.of[IO, Boolean](false)
      worker = new StreamWorker(processor, store(checkpoint, owner),
        (_, _) => IO.raiseError(new AssertionError("must not publish")))
      result <- worker.run(task, version, 2, 7): _ =>
        Stream.exec(owner.set(8)) ++ Stream.emit(Delivery(10, 4, acked.set(true)))
      .attempt
      remaining <- checkpoint.get
      acknowledged <- acked.get
    yield
      assert(result.left.toOption.exists(_.isInstanceOf[StaleOwnership]))
      assertEquals(remaining, state())
      assertEquals(acknowledged, false)

  test("reject an incompatible checkpoint before opening the input"):
    for
      checkpoint <- Ref.of[IO, Checkpoint[Int, Int]](state())
      owner <- Ref.of[IO, Long](7L)
      worker = new StreamWorker(processor, store(checkpoint, owner), (_, _) => IO.unit)
      result <- worker.run(task, version.copy(rules = "rules/2"), 2, 7)(_ =>
        throw new AssertionError("must not open input")).attempt
    yield assert(result.left.toOption.exists(_.isInstanceOf[IncompatibleCheckpoint]))

  test("change rules by migrating a stopped task at its saved input position"):
    val updatedVersion = version.copy(rules = "rules/2")
    for
      checkpoint <- Ref.of[IO, Checkpoint[Int, Int]](state())
      owner <- Ref.of[IO, Long](7L)
      worker = new StreamWorker(processor, store(checkpoint, owner), (_, _) => IO.unit)
      _ <- worker.run(task, version, 2, 7)(_ => Stream.emit(Delivery(10, 4, IO.unit)))
      _ <- owner.set(8)
      migrated <- worker.reconfigure(task, version, updatedVersion, 8)(state => Right(state / 2))
      restarted <- worker.run(task, updatedVersion, 3, 8): after =>
        assertEquals(after, Some(10L))
        Stream.emit(Delivery(11, 2, IO.unit))
    yield
      assertEquals(migrated.state, 4)
      assertEquals(restarted.state, 10)
      assertEquals(restarted.version, updatedVersion)
