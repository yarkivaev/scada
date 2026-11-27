package scada.supervisor.infra.stomp

import cats.effect.{IO, Resource}
import fs2.Stream
import scada.supervisor.core.Decision
import scada.supervisor.infra.config.RabbitMqConfig

/**
 * STOMP subscription emitting operator [[Decision]]s parsed from the
 * `user_decisions` destination. Each session ends on EOF so the next
 * `open` can subscribe again after RabbitMQ restarts.
 *
 * {{{
 * StompDecisions(config).subscribe.evalMap(_.applyTo(segments)).compile.drain
 * }}}
 */
final class StompDecisions(open: Resource[IO, StompLink], dest: String):

  def this(config: RabbitMqConfig) =
    this(
      StompConnection
        .open(
          config.address.host,
          config.address.port,
          config.vhost,
          config.credentials.login,
          config.credentials.passcode
        )
        .map(conn => conn: StompLink),
      config.destinations.userDecisions
    )

  def subscribe: Stream[IO, Decision] =
    Stream
      .resource(open)
      .flatMap: conn =>
        Stream.eval(conn.send(StompFrame.subscribe(dest, "decisions-0"))) >>
          Stream.repeatEval(conn.receive).takeThrough(_.isDefined).unNone.flatMap: frame =>
            Stream.fromOption[IO](decode(frame))
      .repeat

  private def decode(frame: StompFrame): Option[Decision] =
    if frame.command != "MESSAGE" then None else DecisionMessage.parse(frame.body)
