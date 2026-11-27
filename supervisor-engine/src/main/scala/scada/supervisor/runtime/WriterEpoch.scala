package scada.supervisor.runtime

/**
 * Accepts a segment only from the current etcd writer epoch.
 * A fenced leader may still publish; receivers apply one epoch.
 *
 * {{{
 * WriterEpoch.accept(4, 4)
 * }}}
 */
object WriterEpoch:
  /** True when the message epoch is the epoch the quorum still grants. */
  def accept(messageEpoch: Long, currentEpoch: Long): Boolean =
    if messageEpoch < 1 || currentEpoch < 1 then
      throw IllegalArgumentException(s"Writer epoch must be positive, message $messageEpoch current $currentEpoch")
    messageEpoch == currentEpoch
