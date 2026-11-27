package scada.supervisor.core

import cats.Applicative
import cats.effect.{Async, Ref}
import fs2.{Pipe, Stream}
import scala.concurrent.duration.*
import yarkivaev.gapsandislands.api.*

/**
 * Stateless classifier building an `fs2.Pipe` from readings to
 * [[Emission]]s of [[Segment]]s. Delegates the event-loop entirely to
 * `gaps-and-islands`; no per-machine state leaks outside the returned
 * pipe.
 *
 * Classification picks the first [[SegmentDef]] whose condition
 * matches; a missing match extends the currently open segment (or
 * emits the `unclassified` sentinel at stream start). Same-timestamp
 * MQTT metrics are merged before classification so a voltage heartbeat
 * cannot hide a low `power` that arrived in the same instant.
 * Island identity follows classification and a gap longer than
 * `machine.window * 2` seconds. A kind change holds the closed island
 * until the next sample so a 5 s sensor polling period cannot punch a hole in
 * the tape. A timestamp jump without an `off` in the stream does not
 * open a downtime island: the previous island closes and a new pending
 * island of the same kind starts at the later reading. A site can override
 * the class and properties of a reading before rules are evaluated.
 *
 * {{{
 * readings.through(Segmentation[F]().flow(machine, None))
 * }}}
 */
final case class ReadingOverride(name: String, properties: Map[String, String])

final class Segmentation[F[_]: Async](overrideReading: Reading => Option[ReadingOverride] = _ => None):
  import Segmentation.{Evidence, Kind, unclassified}

  def flow(machine: MachineConfig, initial: Option[SegmentCursor] = None): Pipe[F, Reading, Emission[Segment]] =
    (in: Stream[F, Reading]) =>
      Stream.eval(Ref.of[F, Int](0)).flatMap: gap =>
        val maxGap = machine.window.toDouble * 2.0
        val evidence: (Option[Island[Reading, Kind]], Reading) => Evidence = (prev, r) => (prev, r)
        gather(in).through(
            IslandsFlow.pipe(
              policy(machine.segments, gap, maxGap),
              evidence,
              initial.map(Segmentation.toIsland)
            )
          )
          .through(abutKindChange)
          .map(toEmission)
          .unNone

  private def gather(in: Stream[F, Reading]): Stream[F, Reading] =
    in.groupWithin(32, 50.millis).flatMap: chunk =>
      Stream.emits:
        chunk.toList.groupBy(_.timestamp.epoch).toList.sortBy(_._1).map: (_, rows) =>
          rows.reduce((left, right) => Reading(right.timestamp, left.params.merge(right.params)))

  private def policy(defs: List[SegmentDef], gap: Ref[F, Int], maxGap: Double): IslandsPolicy[F, Evidence, Kind] =
    for
      name    <- classification(defs)
      session <- gapSession(gap, maxGap)
    yield (name, session)

  private def classification(defs: List[SegmentDef]): IslandsPolicy[F, Evidence, String] =
    val lookup: String => Option[Condition] = name => defs.find(_.name == name).map(_.condition)
    IslandsPolicy: (prev, reading) =>
      Applicative[F].pure:
        overrideReading(reading).map(_.name)
          .orElse(defs.find(_.condition.matches(reading.params, lookup)).map(_.name))
          .orElse(prev.map(_.kind._1)).getOrElse(unclassified)

  private def gapSession(gap: Ref[F, Int], maxGap: Double): IslandsPolicy[F, Evidence, Int] =
    IslandsPolicy: (prev, reading) =>
      prev match
        case None => gap.get
        case Some(island) =>
          val delta = reading.timestamp.minus(island.last.timestamp)
          if delta > maxGap then gap.updateAndGet(_ + 1)
          else gap.get

  private def abutKindChange(in: Stream[F, IslandEvent[Reading, Kind]]): Stream[F, IslandEvent[Reading, Kind]] =
    Stream.eval(Ref.of[F, Option[Island[Reading, Kind]]](None)).flatMap: held =>
      val body: Stream[F, IslandEvent[Reading, Kind]] = in.flatMap: event =>
        event match
          case IslandEvent.IslandClosed(closed) =>
            Stream.exec(held.set(Some(closed)))
          case started @ IslandEvent.IslandStarted(open) =>
            Stream.eval(held.getAndSet(None)).flatMap:
              case Some(closed) if closed.kind._1 != open.kind._1 =>
                Stream.emit(IslandEvent.IslandClosed(Island(closed.kind, closed.first, open.first)))
                  ++ Stream.emit(started)
              case Some(closed) =>
                Stream.emit(IslandEvent.IslandClosed(closed)) ++ Stream.emit(started)
              case None =>
                Stream.emit(started)
          case other =>
            Stream.eval(held.getAndSet(None)).flatMap:
              case Some(closed) => Stream.emit(IslandEvent.IslandClosed(closed)) ++ Stream.emit(other)
              case None => Stream.emit(other)
      val rest: Stream[F, IslandEvent[Reading, Kind]] = Stream.eval(held.get).flatMap:
        case Some(closed) => Stream.emit(IslandEvent.IslandClosed(closed))
        case None => Stream.empty
      body ++ rest

  private def toEmission(event: IslandEvent[Reading, Kind]): Option[Emission[Segment]] =
    event match
      case IslandEvent.IslandStarted(island) if island.kind._1 != unclassified =>
        Some(Emission.Started(toPending(island)))
      case IslandEvent.IslandExtended(island) if island.kind._1 != unclassified =>
        Some(Emission.Started(toPending(island)))
      case IslandEvent.IslandClosed(island) if island.kind._1 != unclassified =>
        Some(Emission.Emitted(toSegment(island)))
      case _ => None

  private def toPending(island: Island[Reading, Kind]): Segment =
    val start = island.first.timestamp
    val end   = island.last.timestamp
    Segment(island.kind._1, start, end, 0.0, cover(island.last))

  private def toSegment(island: Island[Reading, Kind]): Segment =
    val start = island.first.timestamp
    val end   = island.last.timestamp
    Segment(island.kind._1, start, end, end.minus(start), cover(island.last))

  private def cover(reading: Reading): Map[String, String] =
    overrideReading(reading).fold(Map.empty[String, String])(_.properties)

object Segmentation:
  private type Kind     = (String, Int)
  private type Evidence = (Option[Island[Reading, Kind]], Reading)
  private val unclassified: String = "unclassified"

  private def toIsland(cursor: SegmentCursor): Island[Reading, Kind] =
    val first = Reading(cursor.start, Params(Map.empty))
    val last  = Reading(cursor.end, Params(Map.empty))
    Island((cursor.name, 0), first, last)
