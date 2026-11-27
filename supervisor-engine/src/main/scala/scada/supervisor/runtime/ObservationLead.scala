package scada.supervisor.runtime

/**
 * Lets a standby classify only after local observations cover a real replicated segment.
 * A leader may start when nothing has been replicated. Zero is a missing row, not a watermark.
 *
 * {{{
 * ObservationLead.ready(1790000005000L, Some(1790000005000L), false)
 * ObservationLead.ready(0L, None, true)
 * ObservationLead.leading(Some("leader"), Some("postgres://127.0.0.1:1/scada"))
 * }}}
 */
object ObservationLead:
  /** True for the first writer. A leased process without a role stays a standby. */
  def leading(role: Option[String], lease: Option[String]): Boolean =
    role match
      case Some("leader") => true
      case Some("standby") => false
      case None => lease.forall(_.isEmpty)
      case Some(value) => throw IllegalArgumentException(s"Writer role must be leader or standby, role $value")

  /** True when this process may classify. A standby needs a positive segment end. */
  def ready(observationMs: Long, segmentEndMs: Option[Long], leader: Boolean = true): Boolean =
    if observationMs < 0 || segmentEndMs.exists(_ < 0) then
      throw IllegalArgumentException(s"Replica watermarks must be non-negative integers, telemetry $observationMs segment ${segmentEndMs.getOrElse("none")}")
    segmentEndMs.filter(_ > 0).fold(leader)(end => observationMs >= end)
