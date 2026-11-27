package scada.supervisor.core

import cats.Monad
import cats.MonadThrow
import cats.syntax.all.*

/**
 * Operator response to a pending [[TaggedSegment]]. Smart object: the
 * decision knows how to apply itself to a [[Segments]] collection.
 *
 *   - `Resolve`: retag via [[Tagging]] cascade (path + next options);
 *   - `Split`:   replace the open segment with contiguous sub-segments;
 *   - `Skip`:    dismiss the pending prompt without touching storage.
 *
 * {{{
 * decision.applyTo(segments, tagDefs)
 * }}}
 */
enum Decision:
  case Resolve(machine: MachineId, start: Timestamp, tags: List[String], properties: Map[String, String])
  case Split(machine: MachineId, start: Timestamp, entries: List[SplitEntry])
  case Skip(id: String)

  def applyTo[F[_]: MonadThrow](segments: Segments[F]): F[Unit] =
    applyTo(segments, Nil)

  def applyTo[F[_]: MonadThrow](segments: Segments[F], tagDefs: List[TagDef], tagging: Tagging = Tagging()): F[Unit] = this match
    case Resolve(machine, start, tags, properties) =>
      segments.find(machine, start).flatMap:
        case None      => Monad[F].unit
        case Some(seg) => retag(segments, tagDefs, machine, tags, properties, seg, tagging)

    case Split(machine, start, entries) =>
      (segments.find(machine, start), segments.list(machine)).tupled.flatMap:
        case (None, _) => Monad[F].unit
        case (Some(seg), rows) =>
          val parent = SplitPieces.span(seg, rows, entries)
          try
            val written = SplitPieces.materialize(parent, entries)
            segments.replace(machine, parent.start, parent.end, written)
          catch
            case err: IllegalArgumentException => MonadThrow[F].raiseError(err)

    case Skip(_) => Monad[F].unit

  private def retag[F[_]](
      segments: Segments[F],
      tagDefs: List[TagDef],
      machine: MachineId,
      tags: List[String],
      properties: Map[String, String],
      seg: TaggedSegment,
      tagging: Tagging
  ): F[Unit] =
    val cascaded = tagging.resolve(tagDefs, seg.segment, tags)
    segments.resolve(machine, seg.segment, cascaded.tags, cascaded.options, properties)

/**
 * One piece of a [[Decision.Split]]. `tag` may be empty when the
 * operator does not know the reason. `open` marks the live tail.
 *
 * {{{
 * SplitEntry(Timestamp(100.0), Timestamp(160.0), "maintenance")
 * }}}
 */
final case class SplitEntry(start: Timestamp, end: Timestamp, tag: String, open: Boolean = false):
  def tagged: TaggedSegment = SplitPieces.row(start, this)
