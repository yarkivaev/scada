package scada.supervisor.infra.state

import cats.effect.IO
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.{Files, Path, StandardCopyOption, StandardOpenOption}
import java.nio.charset.StandardCharsets.UTF_8

/** Atomic UTF-8 state file; AtomicStateFile(path).write(json) fsyncs contents and directory. */
final class AtomicStateFile(path: Path):
  def read: IO[Option[String]] = IO.blocking:
    if Files.exists(path) then Some(Files.readString(path)) else None
  def write(json: String): IO[Unit] = IO.blocking:
    Files.createDirectories(path.getParent)
    val temporary = path.resolveSibling(path.getFileName.toString + ".tmp")
    val channel = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
    try
      val bytes = ByteBuffer.wrap(json.getBytes(UTF_8))
      while bytes.hasRemaining do channel.write(bytes)
      channel.force(true)
    finally channel.close()
    Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    val directory = FileChannel.open(path.getParent, StandardOpenOption.READ)
    try directory.force(true) finally directory.close()
