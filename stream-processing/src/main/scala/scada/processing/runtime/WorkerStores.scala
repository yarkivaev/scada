package scada.processing.runtime

import cats.effect.{IO, Ref}
import cats.effect.std.Semaphore
import io.circe.{Decoder, Encoder}
import io.yarkivaev.streamworker.{Checkpoint, CheckpointStore, StaleOwnership, TaskIdentity}
import io.yarkivaev.streamworker.postgres.PgCheckpointStore

object WorkerStores:
  final case class Binding[S, O](store: CheckpointStore[S, O], task: TaskIdentity, ownership: Long)

  /** Claim the database checkpoint before draining pending outputs. Reconcile run mode without changing the outbox. */
  def database[S: Encoder: Decoder, O: Encoder: Decoder](
      db: WorkerDatabase,
      initial: Checkpoint[S, O]
  )(reconcile: S => Option[S]): IO[Binding[S, O]] =
    val store = PgCheckpointStore[S, O](db.transactor)
    val owner = db.generation
    for
      _ <- store.claim(owner, initial)
      saved <- store.loadCompatible(initial.task, initial.version, owner)
      _ <- reconcile(saved.state).fold(IO.unit): next =>
        store.commit(owner, saved.revision, saved.copy(revision = saved.revision + 1L, state = next))
    yield Binding(store, initial.task, owner)

  /** Update the application journal before advancing the in-memory cursor. Caller owns the file lock. */
  def local[S, O](initial: Checkpoint[S, O])(persist: Checkpoint[S, O] => IO[Unit]): IO[Binding[S, O]] =
    val owner = 0L
    for
      state <- Ref.of[IO, Checkpoint[S, O]](initial)
      lock <- Semaphore[IO](1)
    yield
      val store = new CheckpointStore[S, O]:
        def load(task: TaskIdentity, ownership: Long): IO[Checkpoint[S, O]] =
          IO.raiseUnless(task == initial.task && ownership == owner)(StaleOwnership(task, ownership)) *> state.get

        def commit(ownership: Long, expectedRevision: Long, next: Checkpoint[S, O]): IO[Unit] =
          lock.permit.use: _ =>
            IO.uncancelable: _ =>
              load(next.task, ownership).flatMap: current =>
                IO.raiseUnless(current.revision == expectedRevision)(IllegalStateException("Worker checkpoint revision changed")) *>
                  persist(next) *> state.set(next)
      Binding(store, initial.task, owner)
