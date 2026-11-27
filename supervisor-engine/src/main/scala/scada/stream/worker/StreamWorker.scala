package scada.stream.worker

import cats.effect.IO
import fs2.Stream

final case class TaskIdentity(taskId: String, inputId: String, runId: String)
final case class ProcessorVersion(implementation: String, rules: String, stateSchema: String)

final case class OutputId(task: TaskIdentity, position: Long, index: Int)
final case class Output[O](id: OutputId, value: O)

/** Positions identify immutable records in one ordered input. An adapter must not skip unseen records. */
final case class Delivery[I](position: Long, value: I, acknowledge: IO[Unit])

final case class Checkpoint[S, O](
  task: TaskIdentity,
  version: ProcessorVersion,
  revision: Long,
  position: Option[Long],
  state: S,
  pendingOutputs: Vector[Output[O]]
)

final case class StaleOwnership(task: TaskIdentity, ownership: Long)
  extends RuntimeException(s"Ownership $ownership is stale for $task")

final case class IncompatibleCheckpoint(
  expectedTask: TaskIdentity,
  expectedVersion: ProcessorVersion,
  actualTask: TaskIdentity,
  actualVersion: ProcessorVersion
) extends RuntimeException(
  s"Expected checkpoint for $expectedTask at $expectedVersion, found $actualTask at $actualVersion"
)

final case class StepFailed(error: ProcessingError) extends RuntimeException(error.message)
final case class UnconfirmedOutputs(task: TaskIdentity)
  extends RuntimeException(s"Checkpoint for $task still has unconfirmed outputs")

private[worker] object CheckpointCompatibility:
  def check(task: TaskIdentity, version: ProcessorVersion, actualTask: TaskIdentity, actualVersion: ProcessorVersion)
      : IO[Unit] =
    IO.raiseUnless(actualTask == task && actualVersion == version)(
      IncompatibleCheckpoint(task, version, actualTask, actualVersion)
    )

trait CheckpointStore[S, O]:
  /** Load the checkpoint while validating current ownership. */
  def load(task: TaskIdentity, ownership: Long): IO[Checkpoint[S, O]]

  /** Validate the checkpoint version before consumption. Serialized stores can check the header first. */
  def loadCompatible(task: TaskIdentity, version: ProcessorVersion, ownership: Long): IO[Checkpoint[S, O]] =
    load(task, ownership).flatMap: checkpoint =>
      CheckpointCompatibility.check(task, version, checkpoint.task, checkpoint.version).as(checkpoint)

  /** Atomically validate ownership and revision, then replace the checkpoint. */
  def commit(ownership: Long, expectedRevision: Long, next: Checkpoint[S, O]): IO[Unit]

/** Runtime for a deterministic processor. The sink checks ownership and deduplicates by OutputId. */
final class StreamWorker[C, S, I, O](
  processor: Processor[C, S, I, O],
  store: CheckpointStore[S, O],
  publish: (Long, Output[O]) => IO[Unit]
):
  def run(task: TaskIdentity, version: ProcessorVersion, config: C, ownership: Long)(
    input: Option[Long] => Stream[IO, Delivery[I]]
  ): IO[Checkpoint[S, O]] =
    for
      checkpoint <- store.loadCompatible(task, version, ownership)
      start <- deliver(ownership, checkpoint)
      end <- input(start.position)
        .evalMapAccumulate(start): (current, event) =>
          process(config, ownership, current, event).map(next => (next, next))
        .map(_._2)
        .compile
        .last
    yield end.getOrElse(start)

  /** Change rules while input consumption is stopped, after confirming the previous version's outputs.
    * The current codec must be able to read the previous state.
    */
  def reconfigure(task: TaskIdentity, previous: ProcessorVersion, next: ProcessorVersion, ownership: Long)(
    migrate: S => Either[ProcessingError, S]
  ): IO[Checkpoint[S, O]] =
    for
      current <- store.loadCompatible(task, previous, ownership)
      _ <- IO.raiseWhen(current.pendingOutputs.nonEmpty)(UnconfirmedOutputs(task))
      migrated <- IO.defer(IO.fromEither(migrate(current.state).left.map(StepFailed.apply)))
      updated = current.copy(version = next, revision = current.revision + 1, state = migrated)
      _ <- store.commit(ownership, current.revision, updated)
    yield updated

  private def process(config: C, ownership: Long, current: Checkpoint[S, O], event: Delivery[I])
      : IO[Checkpoint[S, O]] =
    if current.position.exists(_ >= event.position) then event.acknowledge.as(current)
    else
      for
        result <- IO.defer(IO.fromEither(
          processor.step(config, current.state, event.value).left.map(StepFailed.apply)
        ))
        outputs = result.outputs.zipWithIndex.map: (value, index) =>
          Output(OutputId(current.task, event.position, index), value)
        updated = current.copy(
          revision = current.revision + 1,
          position = Some(event.position),
          state = result.state,
          pendingOutputs = outputs
        )
        _ <- store.commit(ownership, current.revision, updated)
        _ <- event.acknowledge
        delivered <- deliver(ownership, updated)
      yield delivered

  private def deliver(ownership: Long, current: Checkpoint[S, O]): IO[Checkpoint[S, O]] =
    if current.pendingOutputs.isEmpty then IO.pure(current)
    else
      val updated = current.copy(revision = current.revision + 1, pendingOutputs = Vector.empty[Output[O]])
      Stream.emits(current.pendingOutputs).evalMap(row => publish(ownership, row)).compile.drain *>
        store.commit(ownership, current.revision, updated).as(updated)
