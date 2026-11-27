package scada.processing.core

/**
 * Immutable snapshot of the named metric values attached to one
 * [[Reading]]. Keys are metric names (as configured by routing);
 * values are raw sensor doubles.
 *
 * {{{
 * Params(Map("power" -> 0.95)).value("power")
 * }}}
 */
final case class Params(values: Map[String, Double]):
  def value(key: String): Option[Double] = values.get(key)

  def merge(other: Params): Params = Params(values ++ other.values)
