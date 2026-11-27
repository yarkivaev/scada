package scada.supervisor.core

/**
 * Pure tagging of a [[Segment]] against a list of [[TagDef]]s.
 *
 * Matching:
 *   - with empty `currentTags`, candidates whose `when` equals the segment name;
 *   - with non-empty `currentTags`, candidates whose `when` is in that path.
 *
 * Cascade:
 *   - no matches → keep `currentTags`, empty options (leaf / done);
 *   - one match  → append and continue (auto-deepen);
 *   - many       → keep path as tags, list matches as options.
 *
 * {{{
 * Tagging().resolve(tagDefs, segment)
 * Tagging().resolve(tagDefs, segment, List("metal_structure"))
 * }}}
 */
final class Tagging(allow: Segment => Boolean = _ => true):
  def resolve(tagDefs: List[TagDef], segment: Segment): TaggedSegment =
    resolve(tagDefs, segment, Nil)

  def resolve(tagDefs: List[TagDef], segment: Segment, currentTags: List[String]): TaggedSegment =
    if allow(segment) then deepen(tagDefs, segment, currentTags)
    else TaggedSegment(segment, Nil, Nil, segment.properties)

  private def deepen(tagDefs: List[TagDef], segment: Segment, currentTags: List[String]): TaggedSegment =
    val matching = candidates(tagDefs, segment, currentTags)
    matching match
      case Nil        => TaggedSegment(segment, currentTags, Nil, segment.properties)
      case one :: Nil => deepen(tagDefs, segment, currentTags :+ one)
      case many       => TaggedSegment(segment, currentTags, many, segment.properties)

  private def candidates(tagDefs: List[TagDef], segment: Segment, currentTags: List[String]): List[String] =
    tagDefs.collect:
      case TagDef(name, Condition.When(when)) if matches(when, segment, currentTags) && !currentTags.contains(name) =>
        name

  private def matches(when: String, segment: Segment, currentTags: List[String]): Boolean =
    if currentTags.isEmpty then when == segment.name
    else currentTags.contains(when)
