package scada.supervisor.infra.state

import cats.Functor
import cats.effect.Ref
import cats.syntax.all.*
import scada.supervisor.core.*
import scada.supervisor.core.Segments as CoreSegments
import scala.collection.immutable.SortedMap

/**
 * In-memory [[CoreSegments]] backed by a `Ref` of sorted per-machine
 * maps keyed on `segment.start`. Upsert is idempotent on that key, so
 * a `Started` / `Emitted` pair for the same island simply overwrites
 * the prior row with the finalised segment. When the incoming row carries
 * no operator tags or properties, existing markup on that start is kept;
 * if operator tags are already set, existing options are kept too so a
 * heartbeat cannot replace the prompt list after operator markup.
 *
 * [[resolve]] writes operator `tags` and `properties` on the row keyed by
 * `original.start`. Options:
 *   - non-empty `options` → store that list (cascade next choices / leaf);
 *   - empty `options` → keep the previous options so HMI can re-edit the
 *     same prompt after a resolve that only retags the path.
 *
 * Caller acquires the `Ref` so the class itself stays a plain
 * immutable constructor.
 *
 * {{{
 * Ref.of[F, Map[MachineId, SortedMap[Timestamp, TaggedSegment]]](Map.empty)
 *   .map(Segments(_))
 * segments.resolve(machine, original, tags, options, properties)
 * }}}
 */
final class Segments[F[_]: Functor](
    ref: Ref[F, Map[MachineId, SortedMap[Timestamp, TaggedSegment]]],
    policy: SegmentStatePolicy = SegmentStatePolicy.default
) extends CoreSegments[F]:

  def upsert(machine: MachineId, segment: TaggedSegment): F[Unit] =
    ref.update: state =>
      val machineMap = forMachine(state, machine)
      val stored =
        if SplitFollow.owned(machineMap.values, segment) then SplitFollow.project(machineMap, segment)
        else
          val merged = machineMap.get(segment.segment.start) match
            case Some(existing) => policy.merge(existing, segment)
            case _ =>
              segment
          machineMap.updated(segment.segment.start, merged)
      state.updated(machine, stored)

  /** Exact checkpoint refresh bypasses annotation-preserving upsert and never touches neighbouring keys. */
  def refresh(machine: MachineId, start: Timestamp, row: Option[TaggedSegment]): F[Unit] =
    ref.update: state =>
      val current = forMachine(state,machine)
      val refreshed = row.fold(current - start)(segment => current.updated(start,segment))
      state.updated(machine,refreshed)

  def find(machine: MachineId, start: Timestamp): F[Option[TaggedSegment]] =
    ref.get.map(state => forMachine(state, machine).get(start))

  def list(machine: MachineId): F[List[TaggedSegment]] =
    ref.get.map(state => forMachine(state, machine).values.toList)

  def replace(machine: MachineId, from: Timestamp, to: Timestamp, segments: List[TaggedSegment]): F[Unit] =
    ref.update: state =>
      val cleaned = forMachine(state, machine).filterNot: (_, seg) =>
        seg.segment.start.epoch < to.epoch && seg.segment.end.epoch > from.epoch
      state.updated(machine, segments.foldLeft(cleaned)((m, s) => m.updated(s.segment.start, s)))

  def resolve(
      machine: MachineId,
      original: Segment,
      tags: List[String],
      options: List[String],
      properties: Map[String, String]
  ): F[Unit] =
    ref.update: state =>
      val key = original.start
      val updated = forMachine(state, machine).get(key) match
        case None => forMachine(state, machine)
        case Some(row) =>
          val rows = forMachine(state, machine)
          policy.resolve(row, tags, options, properties).fold(rows)(result => rows.updated(key, result))
      state.updated(machine, updated)

  private def forMachine(
      state: Map[MachineId, SortedMap[Timestamp, TaggedSegment]],
      machine: MachineId
  ): SortedMap[Timestamp, TaggedSegment] =
    state.getOrElse(machine, SortedMap.empty)
