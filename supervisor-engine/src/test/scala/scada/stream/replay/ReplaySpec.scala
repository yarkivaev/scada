package scada.stream.replay

import cats.syntax.all.*
import munit.CatsEffectSuite
import scada.stream.worker.{ProcessingError, Processor, StepResult}

class ReplaySpec extends CatsEffectSuite:
  private enum Event:
    case Open(at: Int, deadline: Int)
    case Label(at: Int, label: String)
    case Tick(at: Int)
    case Fail

  private case class OpenPhase(since: Int, deadline: Int, label: Option[String] = None)

  private val processor = new Processor[Unit, Option[OpenPhase], Event, String]:
    override def step(config: Unit, state: Option[OpenPhase], event: Event)
        : Either[ProcessingError, StepResult[Option[OpenPhase], String]] =
      event match
        case Event.Open(at, deadline) => Right(StepResult(Some(OpenPhase(at, deadline)), Vector.empty))
        case Event.Label(_, label) => Right(StepResult(state.map(_.copy(label = Some(label))), Vector.empty))
        case Event.Tick(at) =>
          state.filter(_.deadline <= at) match
            case Some(phase) =>
              Right(StepResult(None, Vector(s"${phase.since}-$at", phase.label.getOrElse("unlabeled"))))
            case None => Right(StepResult(state, Vector.empty))
        case Event.Fail => Left(ProcessingError("broken event"))

  private val input = ReplayInput("events-1", Vector(Event.Open(2, 8), Event.Tick(3),
    Event.Label(8, "operator"), Event.Tick(8), Event.Open(9, 12), Event.Tick(12)))
  private val manifest = ReplayManifest("timeline", ReplayRange(0, 6), "rules-1",
    input.id, "initial", "timeline-revision", "run-1")
  private val initial = ReplaySeed[Option[OpenPhase]]("initial", "timeline", "rules-1", input.id, 0, None)
  private val afterOpen: ReplaySeed[Option[OpenPhase]] = initial.copy(id = "open", position = 1, state = Some(OpenPhase(2, 8)))
  private val atDeadline: ReplaySeed[Option[OpenPhase]] = afterOpen.copy(id = "deadline", position = 3,
    state = Some(OpenPhase(2, 8, Some("operator"))))

  private def get[A](result: Either[ReplayFailure, A]): A =
    result.fold(failure => fail(failure.toString), identity)

  test("parallel sections preserve the open phase, operator label and deadline at the boundary"):
    val sequential = get(Replay.plan(manifest, input, initial))
    val parallel = get(Replay.plan(manifest, input, initial, Set(1, 3), Vector(atDeadline, afterOpen)))
    for
      reference <- Replay.run(sequential, (), processor)
      candidate <- Replay.run(parallel, (), processor, parallelism = 2)
    yield
      assertEquals(parallel.ranges, Vector(ReplayRange(0, 1), ReplayRange(1, 3), ReplayRange(3, 6)))
      assertEquals(candidate, reference)
      val result = get(candidate)
      assertEquals(result.manifest, manifest)
      assertEquals(result.terminalState, None)
      assertEquals(result.outputs, Vector(ReplayOutput(3, 0, "2-8"), ReplayOutput(3, 1, "operator"),
        ReplayOutput(5, 0, "9-12"), ReplayOutput(5, 1, "unlabeled")))

  test("runs the necessary prefix when a boundary seed is missing, ambiguous or stale"):
    val plan = get(Replay.plan(manifest, input, initial, Set(1, 2, 3),
      Vector(afterOpen.copy(rulesVersion = "older"), afterOpen.copy(position = 2, inputId = "older"),
        afterOpen.copy(timeline = "other"), atDeadline)))
    assertEquals(plan.ranges, Vector(ReplayRange(0, 3), ReplayRange(3, 6)))
    val ambiguous = get(Replay.plan(manifest, input, initial, Set(1),
      Vector(afterOpen, afterOpen.copy(id = "competing", state = None))))
    assertEquals(ambiguous.ranges, Vector(ReplayRange(0, 6)))

  test("rejects an incompatible initial seed or input and a range outside the snapshot"):
    assert(Replay.plan(manifest, input.copy(id = "other"), initial).isLeft)
    assert(Replay.plan(manifest, input, initial.copy(id = "other")).isLeft)
    assert(Replay.plan(manifest, input, initial.copy(position = 1)).isLeft)
    assert(Replay.plan(manifest.copy(range = ReplayRange(0, 7)), input, initial).isLeft)
    assert(Replay.plan(manifest, input, initial, Set(-1)).isLeft)

  test("returns outputs in canonical position and emission order when sections finish out of order"):
    val plan = get(Replay.plan(manifest, input, initial, Set(1, 3), Vector(afterOpen, atDeadline)))
    plan.ranges.reverse.traverse(range => Replay.runSection(plan, range, (), processor)).map: outcomes =>
      val results = outcomes.map(get)
      val gathered = get(Replay.gather(plan, results))
      assertEquals(gathered.outputs.map(output => (output.position, output.ordinal)),
        Vector((3, 0), (3, 1), (5, 0), (5, 1)))
      assert(Replay.gather(plan, results.drop(1)).isLeft)
      assert(Replay.gather(plan, results :+ results.head).isLeft)

  test("refuses to gather completed sections whose boundary states disagree"):
    val bad = afterOpen.copy(state = None)
    val plan = get(Replay.plan(manifest, input, initial, Set(1, 3), Vector(bad, atDeadline)))
    for
      outcomes <- plan.ranges.traverse(range => Replay.runSection(plan, range, (), processor))
      run <- Replay.run(plan, (), processor, parallelism = 2)
    yield
      assertEquals(Replay.gather(plan, outcomes.map(get)), Left(ReplayFailure.BoundaryMismatch(1)))
      assertEquals(run, Left(ReplayFailure.BoundaryMismatch(1)))

  test("refuses sections executed for a different plan"):
    val matching = get(Replay.plan(manifest, input, initial, Set(1), Vector(afterOpen)))
    val different = get(Replay.plan(manifest.copy(baseRevision = "different"), input, initial,
      Set(1), Vector(afterOpen)))
    matching.ranges.traverse(range => Replay.runSection(matching, range, (), processor)).map: outcomes =>
      assert(Replay.gather(different, outcomes.map(get)).isLeft)

  test("an empty range preserves its initial state and emits nothing"):
    val empty = get(Replay.plan(manifest.copy(range = ReplayRange(1, 1), initialSeedId = "open"),
      input, afterOpen, Set(1)))
    Replay.run(empty, (), processor).map: outcome =>
      val result = get(outcome)
      assertEquals(result.terminalState, afterOpen.state)
      assertEquals(result.outputs, Vector.empty)

  test("a processor failure in a section prevents a complete replay result"):
    val broken = input.copy(id = "broken", events = input.events.updated(4, Event.Fail))
    val seed = initial.copy(inputId = broken.id)
    val boundary = atDeadline.copy(inputId = broken.id)
    val plan = get(Replay.plan(manifest.copy(inputId = broken.id), broken, seed, Set(3), Vector(boundary)))
    Replay.run(plan, (), processor, parallelism = 2).map: result =>
      assertEquals(result, Left(ReplayFailure.ProcessingFailed(4, ProcessingError("broken event"))))

  test("a saved positioned state can replay the rest of the same snapshot"):
    val prefixManifest = manifest.copy(range = ReplayRange(0, 3))
    val prefix = get(Replay.plan(prefixManifest, input, initial))
    for
      prefixOutcome <- Replay.run(prefix, (), processor)
      prefixResult = get(prefixOutcome)
      saved = initial.copy(id = "saved", position = prefixResult.manifest.range.until,
        state = prefixResult.terminalState)
      suffix = get(Replay.plan(manifest.copy(range = ReplayRange(3, 6), initialSeedId = saved.id), input, saved))
      suffixOutcome <- Replay.run(suffix, (), processor)
    yield
      val result = get(suffixOutcome)
      assertEquals(result.outputs.map(_.value), Vector("2-8", "operator", "9-12", "unlabeled"))
