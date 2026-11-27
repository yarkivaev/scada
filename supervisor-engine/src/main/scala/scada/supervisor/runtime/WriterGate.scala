package scada.supervisor.runtime

/**
 * Decides whether one process may classify a machine.
 * A second holder is fenced. Classification waits until telemetry
 * covers the replicated segment end.
 *
 * {{{
 * WriterGate.claim(Some("edge-machine-1"), "edge-machine-2")
 * WriterGate.ready(1790000005000L, 1790000005000L)
 * }}}
 */
object WriterGate:
  /** The current holder keeps the lease. A different holder is fenced. */
  def claim(held: Option[String], holder: String): Option[String] =
    if holder.isEmpty then
      throw IllegalArgumentException(s"Lease holder required, holder $holder")
    held match
      case Some(owner) if owner != holder => None
      case _ => Some(holder)

  /**
   * Live classification follows the lock.
   * A leader does not wait for stored history. A standby still does.
   *
   * {{{
   * WriterGate.admit(true, true, false)
   * }}}
   */
  def admit(held: Boolean, leader: Boolean, caughtUp: Boolean): Boolean =
    held && (leader || caughtUp)

  /** True when stored telemetry has reached a real replicated segment. Zero waits. */
  def ready(observationMs: Long, segmentEndMs: Long, leader: Boolean = false): Boolean =
    ObservationLead.ready(observationMs, Some(segmentEndMs), leader)
