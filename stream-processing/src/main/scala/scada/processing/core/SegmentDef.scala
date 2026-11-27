package scada.processing.core

/**
 * One named segment kind for a machine: a label and the predicate
 * deciding whether a reading belongs to it.
 *
 * Order inside [[MachineConfig.segments]] is significant — the first
 * matching definition wins.
 *
 * {{{
 * SegmentDef("on", Condition.Above("power", 0.1))
 * }}}
 */
final case class SegmentDef(name: String, condition: Condition)
