package scada.supervisor.infra.state

import cats.effect.{IO, Resource}
import java.nio.file.Files
import munit.CatsEffectSuite

final class AtomicStateFileSpec extends CatsEffectSuite:
  test("an atomic write replaces the previous checkpoint completely"):
    Resource.make(IO.blocking(Files.createTempDirectory("supervisor-state")))(directory => IO.blocking:
      Files.deleteIfExists(directory.resolve("checkpoint.json"))
      Files.deleteIfExists(directory.resolve("checkpoint.json.tmp"))
      Files.delete(directory)
    ).use: directory =>
      val file = AtomicStateFile(directory.resolve("checkpoint.json"))
      for
        _ <- file.write("{\"cursor\":137,\"pending\":[1]}")
        _ <- file.write("{\"cursor\":283}")
        actual <- file.read
      yield assertEquals(actual, Some("{\"cursor\":283}"))
