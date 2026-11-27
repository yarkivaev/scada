package scada.stream.replay

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import io.yarkivaev.streamworker.{ProcessingError, Processor}

/** A half-open range of offsets in the input snapshot. */
final case class ReplayRange(from: Int, until: Int)

/** The adapter assigns an identity that uniquely names this immutable, ordered event vector.
  * Event timestamps need not be unique because replay positions are vector offsets.
  */
final case class ReplayInput[I](id: String, events: Vector[I])

final case class ReplayManifest(
    timeline: String,
    range: ReplayRange,
    rulesVersion: String,
    inputId: String,
    initialSeedId: String,
    baseRevision: String,
    runId: String
)

/** State immediately before the event at position. */
final case class ReplaySeed[+S](
    id: String,
    timeline: String,
    rulesVersion: String,
    inputId: String,
    position: Int,
    state: S
)

final case class ReplayOutput[O](position: Int, ordinal: Int, value: O)

final case class ReplayResult[S, O](
    manifest: ReplayManifest,
    outputs: Vector[ReplayOutput[O]],
    terminalState: S
)

enum ReplayFailure:
  case InvalidManifest(reason: String)
  case InvalidSections
  case BoundaryMismatch(position: Int)
  case ProcessingFailed(position: Int, error: ProcessingError)

final class ReplayPlan[I, S] private[replay] (
    val manifest: ReplayManifest,
    private[replay] val input: ReplayInput[I],
    private[replay] val sections: Vector[(ReplayRange, ReplaySeed[S])]
):
  def ranges: Vector[ReplayRange] = sections.map(_._1)

private[replay] final case class SectionResult[I, S, O](
    plan: ReplayPlan[I, S],
    range: ReplayRange,
    outputs: Vector[ReplayOutput[O]],
    terminalState: S
)

object Replay:
  def plan[I, S](
      manifest: ReplayManifest,
      input: ReplayInput[I],
      initial: ReplaySeed[S],
      cuts: Set[Int] = Set.empty,
      boundarySeeds: Vector[ReplaySeed[S]] = Vector.empty
  ): Either[ReplayFailure, ReplayPlan[I, S]] =
    val range = manifest.range
    def compatible(seed: ReplaySeed[S]): Boolean =
      seed.timeline == manifest.timeline && seed.rulesVersion == manifest.rulesVersion && seed.inputId == input.id

    if manifest.inputId != input.id then
      Left(ReplayFailure.InvalidManifest("Input identity does not match the manifest"))
    else if range.from < 0 || range.from > range.until || range.until > input.events.size then
      Left(ReplayFailure.InvalidManifest("Replay range is outside the input snapshot"))
    else if !compatible(initial) || initial.id != manifest.initialSeedId || initial.position != range.from then
      Left(ReplayFailure.InvalidManifest("Initial seed does not match the manifest"))
    else if cuts.exists(position => position < range.from || position > range.until) then
      Left(ReplayFailure.InvalidManifest("Section cut is outside the replay range"))
    else
      val boundaries = boundarySeeds.filter: seed =>
        compatible(seed) && cuts(seed.position) && seed.position > range.from && seed.position < range.until
      // A cut without a unique compatible seed stays in the preceding section.
      val seededCuts = boundaries.groupBy(_.position).values.collect:
        case Vector(seed) => seed
      val starts = initial +: seededCuts.toVector.sortBy(_.position)
      val ends = starts.tail.map(_.position) :+ range.until
      val sections = starts.zip(ends).map: (seed, until) =>
        ReplayRange(seed.position, until) -> seed
      Right(new ReplayPlan(manifest, input, sections))

  /** Returns a proposal after every section succeeds and all boundaries agree.
    * The processor, versioned configuration, input, and states must be deterministic and
    * immutable. State equality must compare every value that can affect a later step.
    */
  def run[C, S, I, O](
      plan: ReplayPlan[I, S],
      config: C,
      processor: Processor[C, S, I, O],
      parallelism: Int = 1
  ): IO[Either[ReplayFailure, ReplayResult[S, O]]] =
    if parallelism < 1 then IO.pure(Left(ReplayFailure.InvalidManifest("Parallelism must be positive")))
    else
      Stream.emits(plan.ranges).covary[IO]
        .parEvalMap(parallelism)(range => runSection(plan, range, config, processor))
        .compile.toVector
        .map(_.sequence.flatMap(results => gather(plan, results)))

  private[replay] def runSection[C, S, I, O](
      plan: ReplayPlan[I, S],
      range: ReplayRange,
      config: C,
      processor: Processor[C, S, I, O]
  ): IO[Either[ReplayFailure, SectionResult[I, S, O]]] =
    plan.sections.find(_._1 == range) match
      case None => IO.pure(Left(ReplayFailure.InvalidSections))
      case Some((_, seed)) =>
        IO.defer:
          val outputs = Vector.newBuilder[ReplayOutput[O]]
          def advance(position: Int, state: S): IO[Either[ReplayFailure, SectionResult[I, S, O]]] =
            if position == range.until then
              IO.pure(Right(SectionResult(plan, range, outputs.result(), state)))
            else
              IO.defer:
                processor.step(config, state, plan.input.events(position)) match
                  case Left(error) => IO.pure(Left(ReplayFailure.ProcessingFailed(position, error)))
                  case Right(result) =>
                    outputs ++= result.outputs.iterator.zipWithIndex.map: (value, ordinal) =>
                      ReplayOutput(position, ordinal, value)
                    advance(position + 1, result.state)
          advance(range.from, seed.state)

  private[replay] def gather[I, S, O](
      plan: ReplayPlan[I, S],
      results: Vector[SectionResult[I, S, O]]
  ): Either[ReplayFailure, ReplayResult[S, O]] =
    val ordered = results.sortBy(_.range.from)
    if ordered.map(_.range) != plan.ranges || ordered.exists(result => result.plan ne plan) then
      Left(ReplayFailure.InvalidSections)
    else
      val mismatched = ordered.zip(plan.sections.drop(1)).collectFirst:
        case (result, (range, seed)) if result.terminalState != seed.state => range.from
      mismatched match
        case Some(position) => Left(ReplayFailure.BoundaryMismatch(position))
        case None => Right(ReplayResult(plan.manifest, ordered.flatMap(_.outputs), ordered.last.terminalState))
