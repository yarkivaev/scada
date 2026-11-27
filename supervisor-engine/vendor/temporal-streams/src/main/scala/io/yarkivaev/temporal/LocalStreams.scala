package io.yarkivaev.temporal

final case class Cursor(id: Long, position: Long, touchedAt: Long)
final case class Work(id: Long, streamId: Long, from: Long, until: Long)
final case class Routed(state: LocalStreams, stream: Cursor, work: Work)
/** Snapshot must be persisted by the owner before acknowledging input. Pending work survives eviction. */
final case class LocalStreams(maxGap: Long, idleTimeout: Long, nextId: Long, streams: Vector[Cursor], pending: Vector[Work]):
  require(maxGap >= 0 && idleTimeout > 0)
  def route(point: Observation, now: Long): Routed =
    val eligible = streams.filter(c => c.position <= point.time && BigInt(point.time)-BigInt(c.position) <= maxGap)
    val chosen = eligible.sortBy(c => (c.position,c.id)).lastOption
    val cursor = chosen.fold(Cursor(nextId,point.time,now))(_.copy(position = point.time,touchedAt = now))
    val work = Work(nextId + 1,cursor.id,point.time,point.time)
    val next = copy(nextId = nextId + 2, streams = streams.filterNot(_.id == cursor.id) :+ cursor, pending = pending :+ work)
    Routed(next,cursor,work)
  def evict(now: Long): LocalStreams = copy(streams = streams.filter(c => BigInt(now)-BigInt(c.touchedAt) < idleTimeout))
  def acknowledge(workId: Long): LocalStreams = copy(pending = pending.filterNot(_.id == workId))
  /** The application must compare complete classifier states before passing equivalent=true. */
  def merge(keep: Long, remove: Long, equivalent: Boolean): LocalStreams =
    if !equivalent || keep == remove then this
    else
      (streams.find(_.id == keep),streams.find(_.id == remove)) match
        case (Some(a),Some(b)) if a.position == b.position =>
          copy(streams = streams.filterNot(c => c.id == keep || c.id == remove) :+ a.copy(touchedAt = a.touchedAt.max(b.touchedAt)))
        case _ => this
object LocalStreams:
  def empty(maxGap: Long, idleTimeout: Long): LocalStreams = LocalStreams(maxGap,idleTimeout,1,Vector.empty,Vector.empty)
