package scada.processing.core

import scala.collection.immutable.SortedMap

/**
 * Keeps a classifier heartbeat on an already split `off` island from
 * rewriting the closed pieces. The heartbeat still names the original
 * start. Only the open tail moves, and a later close finishes that tail.
 *
 * {{{
 * SplitFollow.project(rows, heartbeat)
 * }}}
 */
object SplitFollow:
  def owned(rows: Iterable[TaggedSegment], incoming: TaggedSegment): Boolean =
    incoming.segment.name == "off" && family(rows, incoming).nonEmpty

  def project(
      rows: SortedMap[Timestamp, TaggedSegment],
      incoming: TaggedSegment
  ): SortedMap[Timestamp, TaggedSegment] =
    val pieces = family(rows.values, incoming)
    if pieces.isEmpty then rows
    else
      val tail = pieces.maxBy(_.segment.start.epoch)
      moved(tail, incoming) match
        case None       => rows
        case Some(next) => rows.updated(tail.segment.start, next)

  def affected(incoming: TaggedSegment, rows: Iterable[TaggedSegment]): Option[TaggedSegment] =
    val pieces = family(rows, incoming)
    if incoming.segment.name != "off" || pieces.isEmpty then None
    else
      val tail = pieces.maxBy(_.segment.start.epoch)
      moved(tail, incoming).orElse(Some(tail))

  private def family(rows: Iterable[TaggedSegment], incoming: TaggedSegment): List[TaggedSegment] =
    val key = SplitPieces.originKey(incoming.segment.start)
    rows.filter(_.properties.get("split_of").contains(key)).toList

  private def moved(tail: TaggedSegment, incoming: TaggedSegment): Option[TaggedSegment] =
    val start = tail.segment.start
    if tail.segment.duration != 0.0 then None
    else if incoming.segment.duration == 0.0 then
      if !incoming.segment.end.isAfter(tail.segment.end) then None
      else Some(tail.copy(segment = tail.segment.copy(end = incoming.segment.end, duration = 0.0)))
    else if !incoming.segment.end.isAfter(start) then None
    else
      val end = incoming.segment.end
      Some(tail.copy(segment = Segment("off", start, end, end.minus(start))))
