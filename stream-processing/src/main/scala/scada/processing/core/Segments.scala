package scada.processing.core

import io.yarkivaev.segmentation.{Segment, TaggedSegment, Timestamp}
import cats.Monad
import cats.syntax.all.*

/**
 * Persistence boundary for [[TaggedSegment]]s keyed by machine and
 * start timestamp. Abstract over the effect type so decorators
 * (watermark, STOMP publishing) can compose around a concrete
 * in-memory base without pinning the whole core to any runtime.
 *
 * [[resolve]] writes operator `tags` and `properties` on the row
 * keyed by `original.start`. Options:
 *   - non-empty `options` → store that list (cascade next choices / leaf);
 *   - empty `options` → keep the previous options so HMI can re-edit the
 *     same prompt after a resolve that only retags the path.
 *
 * {{{
 * segments.upsert(machineId, taggedSegment)
 * segments.resolve(machine, original, tags, options, properties)
 * }}}
 */
trait Segments[F[_]]:
  def atRevision[A](machine: MachineId)(prepareAndWrite: F[A]): F[A] = prepareAndWrite

  def upsert(machine: MachineId, segment: TaggedSegment): F[Unit]

  def upsertTransition(machine: MachineId, rows: List[TaggedSegment])(using Monad[F]): F[Unit] =
    rows.traverse_(upsert(machine, _))

  def find(machine: MachineId, start: Timestamp): F[Option[TaggedSegment]]

  def list(machine: MachineId): F[List[TaggedSegment]]

  def replace(machine: MachineId, from: Timestamp, to: Timestamp, segments: List[TaggedSegment]): F[Unit]

  def resolve(
      machine: MachineId,
      original: Segment,
      tags: List[String],
      options: List[String],
      properties: Map[String, String]
  ): F[Unit]
