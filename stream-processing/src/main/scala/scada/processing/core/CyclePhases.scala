package scada.processing.core

/**
 * One cycle phase loaded from HOCON: optional `enter` anchor and the
 * flat tag ids allowed while that phase is open.
 *
 * {{{
 * CyclePhase(List("cycle_start", "transfer", "repair"), None)
 * CyclePhase(List("transfer", "repair"), Some("ready"))
 * }}}
 */
final case class CyclePhase(allow: List[String], enter: Option[String])

/**
 * Anchor tag ids that close or advance a production cycle.
 *
 * {{{
 * CycleAnchors("cycle_start", List("planned_stop"))
 * }}}
 */
final case class CycleAnchors(start: String, stop: List[String])

/**
 * Cycle allowlists loaded from generated HOCON. Phase lookup uses
 * anchors of other segments; `flat` keeps HMI button order.
 *
 * {{{
 * phases.options(others)
 * phases.accept(others, standing, tags)
 * }}}
 */
final case class CyclePhases(flat: List[String], anchors: CycleAnchors, phases: List[CyclePhase]):
  def isEmpty: Boolean = phases.isEmpty

  def options(others: List[TaggedSegment]): List[String] =
    val allowed = phaseOf(others).allow.toSet
    flat.filter(allowed.contains)

  def accept(others: List[TaggedSegment], standing: List[String], tags: List[String]): Boolean =
    if isEmpty then true
    else
      val ok = options(others).toSet ++ standing.toSet
      tags.forall(ok.contains)

  def narrow(segment: TaggedSegment, all: List[TaggedSegment]): TaggedSegment =
    if isEmpty || segment.segment.name != "off" then segment
    else
      val past = all.filter(_.segment.start.epoch < segment.segment.start.epoch)
      TaggedSegment(segment.segment, segment.tags, options(past :+ segment), segment.properties)

  private def phaseOf(others: List[TaggedSegment]): CyclePhase =
    val idle = phases.find(_.enter.isEmpty).getOrElse(CyclePhase(Nil, None))
    val tags = others.sortBy(_.segment.start).flatMap(_.tags)
    val lastStop = tags.lastIndexWhere(id => anchors.stop.contains(id))
    val lastStart = tags.lastIndexWhere(_ == anchors.start)
    if lastStart < 0 || lastStart < lastStop then idle
    else entered(tags.drop(lastStart + 1), idle)

  private def entered(after: List[String], idle: CyclePhase): CyclePhase =
    val last = after.reverse.find(id => phases.exists(_.enter.contains(id)))
    last.flatMap(id => phases.find(_.enter.contains(id))).getOrElse:
      phases.find(_.enter.contains(anchors.start)).getOrElse(idle)

object CyclePhases:
  val empty: CyclePhases = CyclePhases(Nil, CycleAnchors("", Nil), Nil)
