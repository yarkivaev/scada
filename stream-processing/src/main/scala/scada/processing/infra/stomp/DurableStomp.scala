package scada.processing.infra.stomp

import cats.effect.{IO, Ref}
import scala.concurrent.duration.*

/**
 * [[StompSender]] that drops a dead socket and opens a new one so
 * segment publish survives a RabbitMQ restart.
 *
 * {{{
 * DurableStomp(StompConnection.connect(...), 3, slot).send(frame)
 * }}}
 */
final class DurableStomp(open: IO[StompSender], attempts: Int, slot: Ref[IO, Option[StompSender]]) extends StompSender:

  def send(frame: StompFrame): IO[Unit] =
    attempt(frame, attempts)

  private def attempt(frame: StompFrame, left: Int): IO[Unit] =
    ensure.flatMap(_.send(frame)).handleErrorWith: err =>
      if left <= 1 then IO.raiseError(err)
      else slot.set(None) *> IO.sleep(100.millis) *> attempt(frame, left - 1)

  private def ensure: IO[StompSender] =
    slot.get.flatMap:
      case Some(sender) => IO.pure(sender)
      case None         => open.flatTap(sender => slot.set(Some(sender)))
