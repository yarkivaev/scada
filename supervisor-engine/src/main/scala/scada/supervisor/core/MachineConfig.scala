package scada.supervisor.core

/**
 * Per-machine supervision configuration.
 *
 * `window` is the nominal sampling window in seconds. Live classification
 * follows observation timestamps only: a quiet source does not close
 * the open segment. A timestamp jump wider than `window * 2` starts a
 * new same-kind island and does not invent downtime.
 *
 * {{{
 * MachineConfig(MachineId("machine-1"), List(...), List(...), 15)
 * }}}
 */
final case class MachineConfig(
    id: MachineId,
    segments: List[SegmentDef],
    tags: List[TagDef],
    window: Int,
    mode: Option[MachineMode] = None
)
