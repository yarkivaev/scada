package io.yarkivaev.temporal

import scala.collection.immutable.TreeMap

/** Times use one application-defined integral unit, consistently throughout the engine. */
final case class Observation(eventId: String, channel: String, time: Long, value: Double)
trait Conflict:
  def choose(first: Observation, incoming: Observation): Observation
object Conflict:
  val first: Conflict = new Conflict:
    def choose(first: Observation, incoming: Observation): Observation = first

/** Immutable reference history. Applications can implement the same semantics in a database. */
final case class History(rows: TreeMap[Long, Map[String, Observation]], seen: Set[String]):
  def accept(point: Observation, conflict: Conflict): History =
    if seen(point.eventId) then this
    else
      val group = rows.getOrElse(point.time, Map.empty)
      val chosen = group.get(point.channel).fold(point)(conflict.choose(_,point))
      copy(rows = rows.updated(point.time, group.updated(point.channel, chosen)), seen = seen + point.eventId)
  def at(time: Long): Vector[Observation] = rows.getOrElse(time,Map.empty).toVector.sortBy(_._1).map(_._2)
  /** Inclusive range plus the immediately preceding and following timestamp groups. */
  def context(from: Long, until: Long): Vector[Observation] =
    require(from <= until)
    val times = rows.keysIterator.filter(t => t >= from && t <= until).toVector
    val before = rows.keysIterator.takeWhile(_ < from).toVector.lastOption
    val after = rows.keysIterator.find(_ > until)
    (before.toVector ++ times ++ after.toVector).flatMap(at)
object History:
  val empty: History = History(TreeMap.empty,Set.empty)
