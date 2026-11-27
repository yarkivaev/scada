package yarkivaev.gapsandislands.api

/**
 * A run of consecutive observations that share the same classification
 * kind.
 *
 * An `Island` is the fundamental unit of output from an [[IslandsFlow]].
 * It represents a contiguous stretch of the input stream in which every
 * observation was classified as the same `kind` by an [[IslandsPolicy]].
 *
 * The library is deliberately agnostic about what an observation is and
 * how time is represented. The island therefore carries the actual
 * `first` and `last` observations of the run rather than any derived
 * metadata: anything domain-specific (duration, midpoint, summary,
 * sampling count) is computed by the caller from the payloads.
 *
 * An `Island` is always non-empty: it is born when an observation is
 * first classified as `kind` and grows as subsequent observations of the
 * same kind arrive. A single-observation run yields an island with
 * `first == last`.
 *
 * ==Example==
 * {{{
 * final case class Tick(timestamp: Long, value: Double)
 *
 * val island = Island(kind = "on", first = Tick(100L, 5.0), last = Tick(180L, 5.2))
 * val durationMs = island.last.timestamp - island.first.timestamp
 * }}}
 *
 * @tparam A the observation payload type chosen by the caller
 * @tparam K the classification kind type chosen by the caller
 * @param kind  the classification shared by every observation in the run
 * @param first the observation that opened this island
 * @param last  the most recent observation that extended this island
 */
final case class Island[A, K](
    kind: K,
    first: A,
    last: A
)
