package scada.stream.worker

final case class ProcessingError(message: String)
final case class StepResult[S, O](state: S, outputs: Vector[O])

/** A deterministic step over inputs already ordered by the source adapter. */
trait Processor[C, S, I, O]:
  def step(config: C, state: S, event: I): Either[ProcessingError, StepResult[S, O]]
