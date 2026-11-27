package scada.processing.core

/**
 * A [[Segment]] decorated with tagging output:
 *   - `tags`       — labels applied automatically or after a decision;
 *   - `options`    — labels the operator still has to choose between
 *                    (non-empty means awaiting [[Decision]]);
 *   - `properties` — operator-attached metadata.
 *
 * {{{
 * TaggedSegment(segment, List("running"), Nil, Map.empty)
 * }}}
 */
final case class TaggedSegment(
    segment: Segment,
    tags: List[String],
    options: List[String],
    properties: Map[String, String]
)
