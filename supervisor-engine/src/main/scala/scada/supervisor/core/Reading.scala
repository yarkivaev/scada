package scada.supervisor.core

/**
 * One sensor observation for a machine at one instant. The atomic
 * input of segmentation.
 *
 * {{{
 * Reading(Timestamp(1700000000.0), Params(Map("power" -> 42.0)))
 * }}}
 */
final case class Reading(timestamp: Timestamp, params: Params)
