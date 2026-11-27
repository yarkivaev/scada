package scada.supervisor.runtime

import cats.effect.{ExitCode, IO, IOApp}

/** Standalone entry point for the built-in rules-based worker. */
object EngineApp extends IOApp:
  private val application = ProcessingApplication(RuntimeProfile.default)
  def run(args: List[String]): IO[ExitCode] = application.run(args)
