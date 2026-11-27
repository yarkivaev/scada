package scada.processing.runtime

import scada.processing.core.MachineId
import scada.processing.infra.config.AppConfig
import scada.processing.infra.checkpoint.PendingSegmentData

/**
 * Orphan pending segment rows left in the checkpoint by repeated
 * crashes. The latest pending row per machine is excluded so
 * [[PendingIsland]] can resume it.
 *
 * {{{
 * Orphans.list(rows)
 * }}}
 */
object Orphans:

  def protectedMachines(config: AppConfig): Set[MachineId] =
    if config.localHistory then config.machines.map(_.id).toSet else Set.empty

  def list(rows: List[PendingSegmentData], historical: Set[MachineId] = Set.empty): List[PendingSegmentData] =
    rows.filterNot(row => historical(row.machine)).groupBy(_.machine).toList.sortBy(_._1.raw).flatMap: (_, xs) =>
      val sorted = xs.sortBy(_.start.epoch)
      sorted.filter(_.name == "on").lastOption match
        case Some(on) => sorted.filterNot(row => row.name == "on" && row.start.epoch == on.start.epoch)
        case None => if sorted.length <= 1 then Nil else sorted.init
