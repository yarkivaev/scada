package scada.processing.infra.stomp

import io.circe.Json
import io.circe.syntax.*
import scada.processing.core.{MachineId, TaggedSegment}

/**
 * Wire-format envelope for one event on the supervisor-sink channel.
 * Knows how to render itself as JSON; STOMP publishing just treats the
 * serialised body as an opaque payload.
 *
 *   - `kind = "segment"` for live classification;
 *   - `kind = "retag"`   for operator-resolved tags;
 *   - `kind = "split"`   for operator-split segments.
 *
 * `status = "pending"` marks a segment still open (duration `0.0`);
 * everything else completes with `"completed"`.
 *
 * {{{
 * SegmentMessage.segment(machineId, taggedSegment).json
 * }}}
 */
final case class SegmentMessage(kind: String, machine: MachineId, segment: TaggedSegment, status: String):
  def json: Json = jsonWith(SegmentWirePolicy.default)

  def jsonWith(policy: SegmentWirePolicy): Json =
    val fields = List(
      "type"       -> Json.fromString(kind),
      "status"     -> Json.fromString(status),
      "machine"    -> Json.fromString(machine.raw),
      "name"       -> Json.fromString(segment.segment.name),
      "start"      -> Json.fromLong(policy.boundary(segment, segment.segment.start)),
      "end"        -> Json.fromLong(policy.boundary(segment, segment.segment.end)),
      "duration"   -> Json.fromDoubleOrNull(segment.segment.duration),
      "tags"       -> listOrNull(segment.tags),
      "options"    -> listOrNull(segment.options),
      "properties" -> mapOrNull(segment.properties)
    )
    Json.obj((if policy.resolved(kind, segment) then fields :+ ("resolved" -> Json.fromBoolean(true)) else fields)*)

  private def listOrNull(values: List[String]): Json =
    if values.isEmpty then Json.Null else values.asJson

  private def mapOrNull(values: Map[String, String]): Json =
    if values.isEmpty then Json.Null else values.asJson

object SegmentMessage:

  def segment(machine: MachineId, ts: TaggedSegment): SegmentMessage =
    val status = if ts.segment.duration == 0.0 then "pending" else "completed"
    SegmentMessage("segment", machine, ts, status)

  def retag(machine: MachineId, ts: TaggedSegment): SegmentMessage =
    SegmentMessage("retag", machine, ts, "completed")

  def split(machine: MachineId, ts: TaggedSegment): SegmentMessage =
    SegmentMessage("split", machine, ts, "completed")
