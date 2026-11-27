package scada.stream.worker.postgres

import cats.effect.IO
import doobie.Transactor

/** Database and token supplied together by an acquired task lease. */
final case class WorkerDatabase(transactor: Transactor[IO], generation: Long)
