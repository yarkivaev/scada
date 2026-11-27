package scada.processing.runtime

import cats.effect.IO
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.processing.core.{MachineConfig, SegmentCursor}
import scada.processing.infra.checkpoint.Checkpoint

/**
 * Resolves the pending open segment cursor for one machine from
 * checkpoint API rows where `duration = 0`.
 *
 * {{{
 * PendingIsland.resolve(Some(checkpoint), machineConfig)
 * }}}
 */
object PendingIsland:

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  def resolve(checkpoint: Option[Checkpoint], machine: MachineConfig): IO[Option[SegmentCursor]] =
    checkpoint match
      case None =>
        IO.pure(None)
      case Some(cp) =>
        cp.fetchPendingSegments.flatMap: rows =>
          val xs = rows.filter(_.machine == machine.id).sortBy(_.start.epoch)
          xs match
            case Nil => IO.pure(None)
            case nonEmpty =>
              val last = nonEmpty.last
              (if nonEmpty.length > 1 then
                 Logger[IO].warn(
                   s"${machine.id.raw}: ${nonEmpty.length} pending segment rows (duration=0); resuming latest at ${last.start.epoch}"
                 )
               else IO.unit) *>
                IO.pure(Some(SegmentCursor(last.name, last.start, last.end)))
