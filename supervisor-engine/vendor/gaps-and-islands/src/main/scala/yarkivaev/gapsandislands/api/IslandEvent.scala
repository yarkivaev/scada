package yarkivaev.gapsandislands.api

/**
 * Event emitted by [[IslandsFlow.pipe]] for every observation.
 *
 * Every input observation produces exactly one or two events:
 *   - [[IslandEvent.IslandStarted]] — the observation opened a new island;
 *   - [[IslandEvent.IslandExtended]] — the observation extended the open
 *     island (same kind as before);
 *   - [[IslandEvent.IslandClosed]] followed by [[IslandEvent.IslandStarted]]
 *     — the observation's kind differed, so the previous island ended
 *     and a new one began.
 *
 * Because every event carries the [[Island]] it describes (with the
 * latest `first`/`last` observations), the stream of events is a
 * lossless record of state: the open island after step N is exactly
 * the island of the most recent event that is not an
 * [[IslandEvent.IslandClosed]].
 *
 * @tparam A the observation payload type
 * @tparam K the classification kind type
 */
sealed trait IslandEvent[A, K]:
  /** The island described by this event. */
  def island: Island[A, K]

object IslandEvent:
  /**
   * A new island has just opened.
   *
   * Emitted on the first observation of a flow or when an
   * observation's classified kind differs from the kind of the
   * currently open island. The island's `first` and `last` both
   * reference the observation that triggered the start.
   */
  final case class IslandStarted[A, K](island: Island[A, K]) extends IslandEvent[A, K]

  /**
   * The current island has absorbed one more observation.
   *
   * Emitted whenever an observation is classified with the same kind
   * as the currently open island. The island's `first` is unchanged;
   * `last` now references the new observation.
   */
  final case class IslandExtended[A, K](island: Island[A, K]) extends IslandEvent[A, K]

  /**
   * A previously open island has just closed.
   *
   * Emitted when a new observation has a different kind than the
   * currently open island; an [[IslandStarted]] follows immediately.
   * The closed island's `last` references the most recent observation
   * that belonged to that run.
   */
  final case class IslandClosed[A, K](island: Island[A, K]) extends IslandEvent[A, K]
