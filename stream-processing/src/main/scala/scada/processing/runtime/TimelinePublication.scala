package scada.processing.runtime

import cats.effect.IO
import cats.syntax.all.*
import io.yarkivaev.segmentation.{TaggedSegment, Timestamp}
import scada.processing.core.{MachineId, Segments}
import scada.processing.infra.checkpoint.Checkpoint

/** Publishes each completed transition with its pending successor in one revision scope. */
object TimelinePublication:
  def publish(
      segments: Segments[IO], machine: MachineId, rows: List[TaggedSegment], compactLimit: Option[Int]
  ): IO[Unit] =
    segments.atRevision(machine):
      batches(rows, compactLimit).traverse_ { group =>
        group.traverse_(row => segments.find(machine, row.segment.start)) *>
          segments.upsertTransition(machine, group)
      }

  private def batches(rows: List[TaggedSegment], compactLimit: Option[Int]): List[List[TaggedSegment]] =
    val pending = rows.lastOption.filter(_.segment.duration == 0)
    val closed = (row: TaggedSegment) => row.segment.duration > 0
    val compacted = compactLimit.filter(_ => pending.nonEmpty).fold(List.empty[TaggedSegment])(_ => rows.filter(closed) ++ pending)
    if compacted.nonEmpty && compactLimit.exists(compacted.size <= _) &&
       compacted.zip(compacted.drop(1)).forall((left, right) => left.segment.end == right.segment.start) then
      List(compacted)
    else
      Iterator.unfold(rows): remaining =>
        val (complete, rest) = remaining.span(closed)
        rest match
          case tail :: next => Some((complete :+ tail, next))
          case Nil if complete.nonEmpty => Some((complete, Nil))
          case Nil => None
      .toList

  /** The authoritative segments take precedence over the older replay cursor. */
  def closedThrough(segments: Segments[IO], machine: MachineId, checkpoint: Option[Checkpoint]): IO[Long] =
    segments.list(machine).flatMap: rows =>
      rows.iterator.filter(_.segment.duration > 0).map(row => millis(row.segment.end)).maxOption match
        case Some(end) => IO.pure(end)
        case None => checkpoint.fold(IO.pure(0L))(_.fetchReplayCursor(machine).map(cursor => math.max(0L, millis(cursor))))

  private def millis(time: Timestamp): Long = math.round(time.epoch * 1000)
