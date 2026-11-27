package scada.processing.infra.stomp

import scada.processing.core.{TaggedSegment, Timestamp}

/** Controls the wire representation and publishing semantics for segment types. */
trait SegmentWirePolicy:
  def boundary(row: TaggedSegment, time: Timestamp): Long = time.millis

  def resolved(kind: String, row: TaggedSegment): Boolean =
    kind == "retag" || kind == "split" || row.tags.nonEmpty

  def confirmed(row: TaggedSegment): Boolean = false
  def splitBeforeSegment(row: TaggedSegment): Boolean = false
  def bypassHeartbeatThrottle(row: TaggedSegment): Boolean = false
  def atomicTransition: Boolean = false

object SegmentWirePolicy:
  val default: SegmentWirePolicy = new SegmentWirePolicy {}
