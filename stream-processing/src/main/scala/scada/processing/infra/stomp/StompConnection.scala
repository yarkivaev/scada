package scada.processing.infra.stomp

import cats.effect.{IO, Resource}
import cats.syntax.all.*
import scala.concurrent.duration.*
import java.io.{BufferedReader, InputStreamReader, OutputStream}
import java.net.{Socket, SocketTimeoutException}

/**
 * Raw TCP STOMP connection. Sends and receives [[StompFrame]]s over a
 * plain socket. Ownership is scoped by the [[Resource]] returned from
 * [[StompConnection.open]]; the connection is closed with a DISCONNECT
 * frame followed by socket close.
 *
 * The socket uses a short `SO_TIMEOUT` so blocking reads surface
 * periodically and [[receive]] can observe cancellation from the
 * surrounding fiber (plain blocking socket reads ignore
 * `Thread.interrupt`).
 *
 * {{{
 * StompConnection.open(host, port, vhost, login, passcode).use(_.send(frame))
 * }}}
 */
/**
 * Minimal send surface used by [[StompSegments]] so unit tests can
 * supply a recording stub without opening a TCP socket.
 */
trait StompSender:
  def send(frame: StompFrame): IO[Unit]

/**
 * Send plus receive surface used by [[StompDecisions]] so tests can
 * supply an in-memory session without a TCP socket.
 */
trait StompLink extends StompSender:
  def receive: IO[Option[StompFrame]]

final class StompConnection(socket: Socket, output: OutputStream, reader: BufferedReader) extends StompLink:

  def send(frame: StompFrame): IO[Unit] =
    write(frame) *> frame.headers.get("receipt").fold(IO.unit)(id => receipt(id).timeout(10.seconds))

  private def receipt(id: String): IO[Unit] =
    receive.flatMap:
      case Some(frame) if frame.command == "RECEIPT" && frame.headers.get("receipt-id").contains(id) => IO.unit
      case Some(frame) if frame.command == "ERROR" => IO.raiseError(IllegalStateException(frame.body))
      case Some(_) => receipt(id)
      case None => IO.raiseError(IllegalStateException("STOMP closed before receipt"))

  private def write(frame: StompFrame): IO[Unit] = IO.blocking:
    output.synchronized:
      output.write(frame.encode)
      output.flush()

  def receive: IO[Option[StompFrame]] =
    def loop(acc: String): IO[Option[StompFrame]] =
      readChunk(acc).flatMap:
        case ReadOutcome.Timeout(partial) => IO.cede *> loop(partial)
        case ReadOutcome.EndOfStream(final0) =>
          IO.pure(if final0.isEmpty then None else StompFrame.decode(final0.dropWhile(c => c == '\n' || c == '\r')))
        case ReadOutcome.FrameEnd(data) =>
          val trimmed = data.dropWhile(c => c == '\n' || c == '\r')
          if trimmed.isEmpty then IO.cede *> loop("") else IO.pure(StompFrame.decode(trimmed))
    loop("")

  private def readChunk(acc: String): IO[ReadOutcome] = IO.blocking:
    val sb = StringBuilder(acc)
    try
      var ch = reader.read()
      if acc.isEmpty && (ch == '\n' || ch == '\r') then ReadOutcome.FrameEnd("")
      else
        while ch != -1 && ch != 0 do
          sb.append(ch.toChar)
          ch = reader.read()
        if ch == -1 then ReadOutcome.EndOfStream(sb.toString) else ReadOutcome.FrameEnd(sb.toString)
    catch case _: SocketTimeoutException => ReadOutcome.Timeout(sb.toString)

  def close: IO[Unit] =
    send(StompFrame.disconnect).attempt *> IO.blocking(socket.close())

private enum ReadOutcome:
  case Timeout(partial: String)
  case EndOfStream(partial: String)
  case FrameEnd(data: String)

object StompConnection:
  private val readTimeoutMillis: Int = 250

  def open(host: String, port: Int, vhost: String, login: String, passcode: String): Resource[IO, StompConnection] =
    Resource.make(connect(host, port, vhost, login, passcode))(_.close)

  def connect(host: String, port: Int, vhost: String, login: String, passcode: String): IO[StompConnection] =
    IO.blocking:
      val socket = Socket(host, port)
      socket.setKeepAlive(true)
      val output = socket.getOutputStream
      val reader = BufferedReader(InputStreamReader(socket.getInputStream, "UTF-8"))
      output.write(StompFrame.connect(vhost, login, passcode).encode)
      output.flush()
      val sb = StringBuilder()
      var ch = reader.read()
      while ch != -1 && ch != 0 do
        sb.append(ch.toChar)
        ch = reader.read()
      socket.setSoTimeout(readTimeoutMillis)
      StompConnection(socket, output, reader)
