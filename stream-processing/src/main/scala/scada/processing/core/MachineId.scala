package scada.processing.core

/**
 * Type-safe identifier for a supervised machine. Opaque over
 * [[String]] so machine ids cannot be mixed up with topic strings,
 * metric names, or tag names at the type level.
 *
 * {{{
 * val id = MachineId("machine-1")
 * id.raw
 * }}}
 */
opaque type MachineId = String

object MachineId:
  def apply(raw: String): MachineId = raw

  extension (self: MachineId) def raw: String = self
