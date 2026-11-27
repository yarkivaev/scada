package yarkivaev.gapsandislands.api

import fs2.{Chunk, Pipe, Pull, Stream}

/**
 * Pure stream transformation that turns a stream of observations into
 * a stream of [[IslandEvent]]s.
 *
 * The library offers no stateful "flow object". State is threaded
 * internally through the pipe's fold over the input; the caller never
 * sees the intermediate cursor. Every input observation produces one
 * or two events, so the emitted stream is a lossless record of the
 * open island over time — any snapshot or derived view is a plain
 * stream operation over that output.
 *
 * The pipe leaves the trailing island open when the input terminates.
 * Callers that need a final [[IslandEvent.IslandClosed]] (finite
 * batches, explicit end-of-run markers) compose their own terminator;
 * doing so is intentionally the caller's concern because the semantics
 * of "the input ended" vary by domain.
 *
 * ==Effect polymorphism==
 * The pipe is parametric in the effect `F[_]`. It imposes no typeclass
 * constraint: the only effectful step is evaluating the supplied
 * [[IslandsPolicy]], which is lifted into the stream via `Pull.eval`.
 * `F` is typically `cats.effect.IO`, but anything that the policy
 * speaks (`SyncIO`, a custom tagless-final algebra, etc.) works.
 *
 * ==Usage==
 * {{{
 * // `F` is inferred from the policy; with an `IslandsPolicy[IO, _, _]`
 * // the pipe is `Pipe[IO, A, IslandEvent[A, K]]`.
 * val events: Stream[F, IslandEvent[Tick, String]] =
 *   observations.through(IslandsFlow.pipe(policy, evidence))
 *
 * // lifecycle-only view
 * events.collect {
 *   case e: IslandEvent.IslandStarted[Tick, String] => e
 *   case e: IslandEvent.IslandClosed[Tick, String]  => e
 * }
 *
 * // open-island checkpoint at each step
 * events.map(_.island)
 * }}}
 */
object IslandsFlow:

  /**
   * Build a gaps-and-islands transformation.
   *
   * The returned pipe consumes observations of type `A`, asks the
   * supplied [[IslandsPolicy]] to classify each into a kind of type
   * `K`, and emits [[IslandEvent]]s describing how the island
   * structure evolves.
   *
   * ==Recovery==
   * Pass `initial = Some(island)` to resume from a previously
   * snapshotted open island. No [[IslandEvent.IslandStarted]] is
   * emitted for the resumed island; the next observation will either
   * extend it (emitting [[IslandEvent.IslandExtended]]) or close it
   * (emitting [[IslandEvent.IslandClosed]] followed by
   * [[IslandEvent.IslandStarted]]).
   *
   * ==Snapshot==
   * The open island at any point is the `island` of the latest
   * non-`IslandClosed` event. Derive it with a plain `scan`:
   * {{{
   * events.scan(Option.empty[Island[A, K]]) {
   *   case (_, IslandEvent.IslandClosed(_)) => None
   *   case (_, other)                       => Some(other.island)
   * }
   * }}}
   *
   * ==Terminal close==
   * The pipe emits no event when the input terminates. Callers that
   * treat the input as a finite batch and want a final
   * [[IslandEvent.IslandClosed]] add one themselves, for example via
   * a post-processing pipe that tracks the open island and emits a
   * close on end-of-stream.
   *
   * @tparam F       the effect used to evaluate the policy
   * @tparam A       the observation payload type
   * @tparam K       the classification kind type
   * @tparam E       the evidence type consumed by the policy
   * @param policy   decision rule used to classify each observation
   * @param evidence builds the policy's input from the currently open
   *                 island (if any) and the incoming observation
   * @param initial  optional open island to resume from
   */
  def pipe[F[_], A, K, E](
      policy: IslandsPolicy[F, E, K],
      evidence: (Option[Island[A, K]], A) => E,
      initial: Option[Island[A, K]] = None
  ): Pipe[F, A, IslandEvent[A, K]] =
    input => advance(initial, input, policy, evidence).stream

  private def advance[F[_], A, K, E](
      state: Option[Island[A, K]],
      input: Stream[F, A],
      policy: IslandsPolicy[F, E, K],
      evidence: (Option[Island[A, K]], A) => E
  ): Pull[F, IslandEvent[A, K], Unit] =
    input.pull.uncons1.flatMap:
      case None => Pull.done
      case Some((item, rest)) =>
        Pull.eval(policy.decide(evidence(state, item))).flatMap: kind =>
          val (next, events) = step(state, item, kind)
          Pull.output(Chunk.from(events)) >> advance(next, rest, policy, evidence)

  private def step[A, K](
      state: Option[Island[A, K]],
      item: A,
      kind: K
  ): (Option[Island[A, K]], List[IslandEvent[A, K]]) =
    state match
      case None =>
        val fresh = Island(kind, item, item)
        (Some(fresh), List(IslandEvent.IslandStarted(fresh)))
      case Some(open) if open.kind == kind =>
        val extended = Island(kind, open.first, item)
        (Some(extended), List(IslandEvent.IslandExtended(extended)))
      case Some(open) =>
        val fresh = Island(kind, item, item)
        (Some(fresh), List(
          IslandEvent.IslandClosed(open),
          IslandEvent.IslandStarted(fresh)
        ))
