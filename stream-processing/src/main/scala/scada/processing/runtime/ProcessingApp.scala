package scada.processing.runtime

import cats.effect.{ExitCode, IO, IOApp}

/** Standalone entry point for the built-in rules-based worker. */
object ProcessingApp extends IOApp:
  private val application = ProcessingApplication(RuntimeProfile.default)
  def run(args: List[String]): IO[ExitCode] = application.run(args)
