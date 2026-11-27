package io.yarkivaev.temporal

final case class Segment(id: String, start: Long, end: Long, kind: String, ancestors: Set[String]):
  require(start <= end)
final case class Annotation(id: String, anchor: String, value: String, applicableKinds: Set[String])
final case class Decorated(segment: Segment, annotations: Vector[String])
object Overlay:
  /** Does not merge segments. Ancestry follows extension and splitting, never timestamp proximity. */
  def apply(segments: Vector[Segment], annotations: Vector[Annotation], cuts: Vector[Long]): Vector[Decorated] =
    segments.flatMap: segment =>
      val marks = annotations.filter(a => (a.anchor == segment.id || segment.ancestors(a.anchor)) && a.applicableKinds(segment.kind)).map(_.id)
      val boundaries = Vector(segment.start) ++ cuts.filter(t => t > segment.start && t < segment.end).distinct.sorted ++ Vector(segment.end)
      boundaries.sliding(2).collect:
        case Vector(start,end) => Decorated(segment.copy(id = if start == segment.start then segment.id else s"${segment.id}:cut:$start",start = start,end = end), marks)
      .toVector
