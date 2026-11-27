package scada.processing.core

/**
 * Turns one operator split of an `off` island into flat `off` rows.
 * Each row keeps `name = off`, carries at most one tag, and records
 * `properties.split_of` as the original island start in epoch millis.
 * The first row reuses that start. A last row with `open` stays pending
 * (`duration == 0`). [[span]] widens the parent to the contiguous saved
 * family when the new entries cover that whole island, so deleting one
 * piece merges the rest.
 *
 * {{{
 * SplitPieces.materialize(parent, List(
 *   SplitEntry(parent.start, Timestamp(160.0), "maintenance"),
 *   SplitEntry(Timestamp(160.0), parent.end, "")
 * ))
 * }}}
 */
object SplitPieces:
  def originKey(start: Timestamp): String = start.millis.toString

  def row(origin: Timestamp, entry: SplitEntry): TaggedSegment =
    val duration = if entry.open then 0.0 else entry.end.minus(entry.start)
    val tags = if entry.tag.isEmpty then Nil else List(entry.tag)
    TaggedSegment(
      Segment("off", entry.start, entry.end, duration),
      tags,
      Nil,
      Map("split_of" -> originKey(origin))
    )

  def span(anchor: TaggedSegment, rows: List[TaggedSegment], entries: List[SplitEntry]): Segment =
    val key = anchor.properties.getOrElse("split_of", originKey(anchor.segment.start))
    val kin = rows.filter(row => row.segment.name == "off" && row.properties.get("split_of").contains(key))
      .sortBy(_.segment.start.millis)
    val run = pieceRun(anchor, kin)
    if run.nonEmpty && covers(run, entries) then bounds(run) else anchor.segment

  private def pieceRun(anchor: TaggedSegment, kin: List[TaggedSegment]): List[TaggedSegment] =
    val index = kin.indexWhere(_.segment.start.millis == anchor.segment.start.millis)
    if index < 0 then Nil
    else kin.slice(leftOf(kin, index), rightOf(kin, index) + 1)

  private def leftOf(kin: List[TaggedSegment], index: Int): Int =
    if index == 0 || kin(index - 1).segment.end.millis != kin(index).segment.start.millis then index
    else leftOf(kin, index - 1)

  private def rightOf(kin: List[TaggedSegment], index: Int): Int =
    if index == kin.length - 1 || kin(index).segment.end.millis != kin(index + 1).segment.start.millis then index
    else rightOf(kin, index + 1)

  private def covers(run: List[TaggedSegment], entries: List[SplitEntry]): Boolean =
    val ordered = entries.sortBy(_.start.millis)
    val head = run.head.segment
    val tail = run.last.segment
    ordered.nonEmpty && ordered.head.start.millis == head.start.millis &&
      (if tail.duration == 0.0 then ordered.last.open else !ordered.last.open && ordered.last.end.millis == tail.end.millis)

  private def bounds(run: List[TaggedSegment]): Segment =
    val head = run.head.segment
    val tail = run.last.segment
    val duration = if tail.duration == 0.0 then 0.0 else tail.end.minus(head.start)
    Segment("off", head.start, tail.end, duration)

  def materialize(parent: Segment, entries: List[SplitEntry]): List[TaggedSegment] =
    if parent.name != "off" then
      throw new IllegalArgumentException(
        s"refusing to split ${parent.name} starting at ${parent.start.millis}"
      )
    if entries.isEmpty then
      throw new IllegalArgumentException(
        s"refusing an empty split of off at ${parent.start.millis}"
      )
    val ordered = entries.sortBy(_.start.epoch)
    if ordered.head.start.millis != parent.start.millis then
      throw new IllegalArgumentException(
        s"split of off at ${parent.start.millis} must keep that start, got ${ordered.head.start.millis}"
      )
    if !ordered.exists(_.tag.nonEmpty) then
      throw new IllegalArgumentException(
        s"split of off at ${parent.start.millis} has no tagged piece"
      )
    ordered.zipWithIndex.foreach: (entry, index) =>
      val last = index == ordered.length - 1
      if entry.open && !last then
        throw new IllegalArgumentException(
          s"open piece at ${entry.start.millis} is not the tail of off at ${parent.start.millis}"
        )
      if index > 0 && ordered(index - 1).end.millis != entry.start.millis then
        throw new IllegalArgumentException(
          s"split of off at ${parent.start.millis} has a gap before ${entry.start.millis}"
        )
      val span = entry.end.minus(entry.start)
      if span < 0 then
        throw new IllegalArgumentException(
          s"piece at ${entry.start.millis} ends before it starts"
        )
    if parent.duration != 0.0 && (ordered.last.open || ordered.last.end.millis != parent.end.millis) then
      throw new IllegalArgumentException(
        s"closed off at ${parent.start.millis} must be covered through ${parent.end.millis}"
      )
    ordered.map(entry => row(parent.start, entry))
