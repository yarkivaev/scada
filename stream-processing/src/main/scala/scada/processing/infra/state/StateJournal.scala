package scada.processing.infra.state

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import io.circe.{Decoder, Encoder}
import java.nio.channels.FileChannel
import java.nio.file.{Files, Path, StandardOpenOption}

/** Owns a process lock while reading or saving an atomically replaced JSON checkpoint. */
final class StateJournal[A: Encoder: Decoder] private (file: AtomicStateFile, initial: A):
  def load: IO[A] = file.readJson[A].map(_.getOrElse(initial))
  def save(checkpoint: A): IO[Unit] = file.writeJson(checkpoint)

object StateJournal:
  def open[A: Encoder: Decoder](file: String, initial: A): Resource[IO, StateJournal[A]] =
    val path = Path.of(file).toAbsolutePath
    val lockPath = path.resolveSibling(path.getFileName.toString + ".lock")
    Resource.eval(IO.blocking(Files.createDirectories(path.getParent))) *>
      Resource.fromAutoCloseable(IO.blocking(FileChannel.open(lockPath, StandardOpenOption.CREATE, StandardOpenOption.WRITE))).flatMap: channel =>
        Resource.make(IO.blocking(Option(channel.tryLock()).getOrElse(throw IllegalStateException(s"Checkpoint already owned: $file"))))(
          lock => IO.blocking(lock.release())
        ).as(new StateJournal(AtomicStateFile(path), initial))
