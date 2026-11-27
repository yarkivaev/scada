package scada.supervisor.infra.state

import scada.supervisor.core.TaggedSegment

/** Preserves or replaces operator annotations when a segment is updated. */
trait SegmentStatePolicy:
  def merge(existing: TaggedSegment, incoming: TaggedSegment): TaggedSegment =
    if incoming.tags.isEmpty && incoming.properties.isEmpty then
      val options = if existing.tags.nonEmpty then existing.options else incoming.options
      TaggedSegment(incoming.segment, existing.tags, options, existing.properties)
    else incoming

  def resolve(row: TaggedSegment, tags: List[String], options: List[String], properties: Map[String, String]): Option[TaggedSegment] =
    val kept = if options.isEmpty then row.options else options
    Some(TaggedSegment(row.segment, tags, kept, properties))

object SegmentStatePolicy:
  val default: SegmentStatePolicy = new SegmentStatePolicy {}
