package scada.processing.core

/**
 * Declarative predicate over a single [[Reading]]. Smart object:
 * every case answers [[matches]] for itself.
 *
 * `When(name)` delegates to the condition of the same-named
 * [[SegmentDef]]; callers pass a `lookup` function that resolves the
 * reference. In tagging context `When` is matched by name only, not
 * by evaluating this predicate.
 *
 * {{{
 * Condition.Above("power", 5.0).matches(Params(Map("power" -> 42.0)))
 * }}}
 */
enum Condition:
  case Above(param: String, threshold: Double)
  case Below(param: String, threshold: Double)
  case Equal(param: String, value: Double)
  case And(left: Condition, right: Condition)
  case Or(left: Condition, right: Condition)
  case When(segmentName: String)

  def matches(params: Params): Boolean =
    matches(params, _ => None)

  def matches(params: Params, lookup: String => Option[Condition]): Boolean = this match
    case Above(param, threshold) => params.value(param).exists(_ >= threshold)
    case Below(param, threshold) => params.value(param).exists(_ < threshold)
    case Equal(param, value)     => params.value(param).contains(value)
    case And(left, right)        => left.matches(params, lookup) && right.matches(params, lookup)
    case Or(left, right)         => left.matches(params, lookup) || right.matches(params, lookup)
    case When(name)              => lookup(name).exists(_.matches(params, lookup))
