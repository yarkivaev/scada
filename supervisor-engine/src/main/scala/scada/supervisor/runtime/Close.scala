package scada.supervisor.runtime

import cats.effect.IO
import scada.supervisor.core.*
import scada.supervisor.core.Segments as CoreSegments
import scada.supervisor.infra.checkpoint.PendingSegmentData

/**
 * Completes one pending segment row in storage. Upsert carries empty
 * tags and properties so supervisor-sink preserves operator markup.
 *
 * {{{
 * Close.run(segments, row)
 * }}}
 */
object Close:

  private val closeSeconds = 1.0

  def run(segments: CoreSegments[IO], row: PendingSegmentData): IO[Unit] =
    val end = Timestamp(row.start.epoch + closeSeconds)
    val seg = TaggedSegment(Segment(row.name, row.start, end, closeSeconds), Nil, Nil, Map.empty)
    segments.upsert(row.machine, seg)
