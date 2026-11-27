package scada.processing.core

/**
 * A named, closed time interval produced by segmentation from a
 * contiguous run of readings that matched the same [[SegmentDef]].
 *
 * `duration == 0.0` marks a just-started (pending) segment whose
 * closing boundary a later reading will reveal.
 *
 * {{{
 * Segment("on", Timestamp(100.0), Timestamp(200.0), 100.0)
 * }}}
 */
final case class Segment(
    name: String,
    start: Timestamp,
    end: Timestamp,
    duration: Double,
    properties: Map[String, String] = Map.empty
)

/**
 * Open-segment resume cursor from Postgres (`segments` row with
 * `duration = 0`). Fed into [[Segmentation]] as the initial
 * gaps-and-islands island; `end` may advance beyond `start` via
 * pending heartbeats.
 */
final case class SegmentCursor(name: String, start: Timestamp, end: Timestamp)
