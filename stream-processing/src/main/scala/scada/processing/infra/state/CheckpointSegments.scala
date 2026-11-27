package scada.processing.infra.state

import io.yarkivaev.segmentation.{Segment, TaggedSegment, Timestamp}
import cats.effect.IO
import cats.syntax.all.*
import scada.processing.core.*
import scada.processing.core.Segments as CoreSegments
import scada.processing.infra.checkpoint.Checkpoint

/**
 * [[CoreSegments]] decorator that falls back to checkpoint API when
 * the in-memory store misses one segment row. `list` uses the local cache unless checkpoint-first reads are configured.
 * History-mode decision reads may prefer checkpoint snapshots, refreshing exact
 * cached keys through an injected port. Lists refresh already-known sibling keys;
 * this decorator does not download or discover the complete historical family.
 * A segment write must not download machine history: the site paints
 * shutdown reasons on read.
 *
 * {{{
 * CheckpointSegments(StateSegments(ref), checkpoint)
 * }}}
 */
final class CheckpointSegments(
    underlying: CoreSegments[IO],
    checkpoint: Checkpoint,
    preferCheckpoint: Boolean = false,
    refreshCache: Option[(MachineId,Timestamp,Option[TaggedSegment]) => IO[Unit]] = None
) extends CoreSegments[IO]:
  require(!preferCheckpoint || refreshCache.isDefined,"Checkpoint-first decisions require an exact cache refresh port")

  override def atRevision[A](machine: MachineId)(action: IO[A]): IO[A] = underlying.atRevision(machine)(action)

  def find(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]] =
    if preferCheckpoint then checkpoint.fetchSegment(machine,start).flatTap(row => refreshCache.get(machine,start,row))
    else underlying.find(machine, start).flatMap:
      case some @ Some(_) => IO.pure(some)
      case None =>
        checkpoint.fetchSegment(machine, start).flatMap:
          case None => IO.pure(None)
          case Some(segment) =>
            underlying.upsert(machine, segment).as(Some(segment))

  def list(machine: MachineId): IO[List[TaggedSegment]] =
    if preferCheckpoint then underlying.list(machine).flatMap(_.traverse(row => find(machine,row.segment.start)).map(_.flatten))
    else underlying.list(machine)

  def upsert(machine: MachineId, segment: TaggedSegment): IO[Unit] =
    underlying.upsert(machine, segment)

  def replace(machine: MachineId, from: Timestamp, to: Timestamp, segments: List[TaggedSegment]): IO[Unit] =
    underlying.replace(machine, from, to, segments)

  def resolve(
      machine: MachineId,
      original: Segment,
      tags: List[String],
      options: List[String],
      properties: Map[String, String]
  ): IO[Unit] =
    find(machine, original.start).flatMap:
      case None => IO.unit
      case Some(fresh) => underlying.resolve(machine, if preferCheckpoint then fresh.segment else original, tags, options, properties)
