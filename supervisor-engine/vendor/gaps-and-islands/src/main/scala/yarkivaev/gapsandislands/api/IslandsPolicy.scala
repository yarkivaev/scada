package yarkivaev.gapsandislands.api

import cats.Monad
import cats.data.Kleisli

/**
 * Decision rule that classifies an observation into a kind.
 *
 * An `IslandsPolicy` is the only place where the caller expresses domain
 * meaning. Given whatever evidence it needs — the observation itself, a
 * rolling window, a lookup against a database, the previously open
 * island — it returns the kind `K` to which the current observation
 * belongs. The [[IslandsFlow]] then uses that kind to decide whether to
 * extend the current island or close it and open a new one.
 *
 * There is no privileged "boundary" or "gap" outcome: every observation
 * belongs to some island. If the caller wants to distinguish missing
 * data, idle periods, or rejected samples from useful runs, they encode
 * that distinction as a dedicated value of `K` (for example a
 * `"gap"` string or a `Gap` variant of a sealed trait).
 *
 * ==Composition==
 * Policies form a monad over `K` in their shared `F` and `Evidence`.
 * `flatMap` runs every stage on every observation, which lets callers
 * build refined decisions pipeline-style, for example "first tag as
 * live-or-stale, then classify live samples as on-or-off":
 *
 * {{{
 * val tagFreshness: IslandsPolicy[IO, Tick, String] =
 *   IslandsPolicy(t => IO.pure(if t.ageMs > 30000 then "stale" else "live"))
 *
 * val refine: String => IslandsPolicy[IO, Tick, String] =
 *   case "live" => IslandsPolicy(t => IO.pure(if t.power >= 5.0 then "on" else "off"))
 *   case other  => IslandsPolicy(_ => IO.pure(other))
 *
 * val policy = tagFreshness.flatMap(refine)
 * }}}
 *
 * @tparam F        the effect type used to evaluate the decision
 * @tparam Evidence the contextual input the policy needs to decide;
 *                  contravariant so narrower evidence types can be
 *                  supplied than declared
 * @tparam K        the classification kind returned by this policy
 */
trait IslandsPolicy[F[_], -Evidence, K]:
  /**
   * Classify the observation described by `evidence`.
   *
   * Implementations should be referentially transparent with respect to
   * the supplied evidence; any mutable state they need must live inside
   * `F`.
   *
   * @param evidence everything the caller has decided the policy needs
   * @return the kind of island the current observation belongs to
   */
  def decide(evidence: Evidence): F[K]

object IslandsPolicy:
  /**
   * Build a policy from a plain decision function.
   *
   * @param fn function mapping evidence to an effectful kind
   */
  def apply[F[_], E, K](fn: E => F[K]): IslandsPolicy[F, E, K] =
    new IslandsPolicy[F, E, K]:
      def decide(evidence: E): F[K] =
        fn(evidence)

  /**
   * Lift a `cats.data.Kleisli` into an `IslandsPolicy`.
   *
   * Useful when callers already express their decision logic as a
   * `Kleisli[F, E, K]` and want to reuse its combinators before handing
   * the rule to a flow.
   */
  def liftKleisli[F[_], E, K](rule: Kleisli[F, E, K]): IslandsPolicy[F, E, K] =
    apply(rule.run)

  extension [F[_], E, K](policy: IslandsPolicy[F, E, K])
    /**
     * Post-process the kind produced by this policy.
     *
     * `map` is a pure relabelling: it never changes whether an
     * observation is classified, only how the resulting kind is named.
     *
     * @param fn    transformation applied to the classified kind
     * @param monad monad instance for the policy's effect
     */
    def map[L](fn: K => L)(using monad: Monad[F]): IslandsPolicy[F, E, L] =
      IslandsPolicy(evidence => monad.map(policy.decide(evidence))(fn))

    /**
     * Chain a second decision stage onto this policy.
     *
     * Both stages are evaluated on every observation; the kind produced
     * by the first stage is fed into the function that chooses the next
     * policy. This models refinement pipelines where later stages
     * specialise the classification of earlier stages.
     *
     * @param next  function producing the next policy from the previous kind
     * @param monad monad instance for the policy's effect
     */
    def flatMap[L](next: K => IslandsPolicy[F, E, L])(using monad: Monad[F]): IslandsPolicy[F, E, L] =
      IslandsPolicy: evidence =>
        monad.flatMap(policy.decide(evidence))(kind => next(kind).decide(evidence))
