package scada.supervisor.infra.mqtt

import cats.effect.IO
import fs2.Stream
import scala.concurrent.duration.FiniteDuration

/**
 * Repeats an inner readings stream after it ends so a dropped MQTT
 * session is followed by a fresh `open`.
 *
 * {{{
 * Sessions(1.second).repeat(IO(session))
 * }}}
 */
final class Sessions(pause: FiniteDuration):

  def repeat[A](open: IO[Stream[IO, A]]): Stream[IO, A] =
    Stream.force(open) ++ Stream.sleep_[IO](pause) ++ repeat(open)
