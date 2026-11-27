package scada.supervisor.infra.checkpoint

import cats.effect.IO
import fs2.Stream
import scada.supervisor.core.*

/**
 * One raw metric row used to seed segmentation on startup.
 *
 * {{{
 * RawReadingData("machine-1/power", Timestamp(1700000000.0), 42.0)
 * }}}
 */
final case class RawReadingData(topic: String, timestamp: Timestamp, value: Double)

/** One pending segment row from `segments` where `duration = 0`. */
final case class PendingSegmentData(machine: MachineId, name: String, start: Timestamp, end: Timestamp)

/**
 * Historical readings boundary. Returns rows strictly newer than the
 * supplied watermark so the supervisor can replay them deterministically
 * before taking the live MQTT stream. Abstract over the backing store
 * so unit tests can substitute an in-memory fake.
 */
trait Checkpoint:
  /**
   * Replay cursor derived from persisted segments for one machine.
   *
   * Rule:
   *   - `closedEnd`   = max(end_time) where `duration > 0`
   *   - `pendingStart` = max(start_time) where `duration = 0`
   *   - cursor = min(closedEnd, pendingStart) when pending exists,
   *              else closedEnd, else 0.0
   *
   * This keeps replay anchored to durable segment state while still
   * rewinding to the pending boundary when an open segment exists.
   */
  def fetchReplayCursor(machine: MachineId): IO[Timestamp]

  def fetchReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData]

  /** Required-history recovery retries a failed fetch instead of treating it as an empty history. */
  def fetchRequiredReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData] =
    fetchReadings(topics, from)

  /** Pending open segments (`duration = 0`), for island resume. */
  def fetchPendingSegments: IO[List[PendingSegmentData]]

  /** One closed segment row at an exact start timestamp, if present. */
  def fetchSegment(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]]

  /** Offs before `before` until a reset tag, chronological. Empty when unused. */
  def fetchCyclePrior(machine: MachineId, before: Timestamp, reset: List[String]): IO[List[TaggedSegment]] =
    IO.pure(Nil)

object Checkpoint:
  def empty: Checkpoint = new Checkpoint:
    def fetchReplayCursor(machine: MachineId): IO[Timestamp] = IO.pure(Timestamp(0.0))
    def fetchReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData] = Stream.empty
    def fetchPendingSegments: IO[List[PendingSegmentData]] = IO.pure(Nil)
    def fetchSegment(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]] = IO.pure(None)
