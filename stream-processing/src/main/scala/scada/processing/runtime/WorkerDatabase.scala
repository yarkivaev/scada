package scada.processing.runtime

import cats.effect.IO
import doobie.Transactor

/** Checkpoint access supplied by the SCADA classifier lease. */
final case class WorkerDatabase(transactor: Transactor[IO], generation: Long)
