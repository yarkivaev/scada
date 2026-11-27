package scada.processing.core

/**
 * One conditional label. When exactly one [[TagDef]] matches a
 * [[Segment]] the label is applied automatically; when several match
 * they land in `options` and trigger a [[Decision]].
 *
 * {{{
 * TagDef("running", Condition.When("on"))
 * }}}
 */
final case class TagDef(name: String, condition: Condition)
