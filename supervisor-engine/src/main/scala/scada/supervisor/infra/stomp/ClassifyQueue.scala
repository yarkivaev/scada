package scada.supervisor.infra.stomp

import cats.effect.{IO, Resource}
import fs2.Stream
import io.circe.parser.parse
import io.yarkivaev.temporal.Observation
import scada.supervisor.infra.config.{AliasMapping, RabbitMqConfig}

/**
 * Durable AMQP classify queue for one machine. MQTT slash aliases match
 * dotted routing keys. First-wins identity is the published eventId.
 *
 * {{{
 * ClassifyQueue(config, "scada.classify.machine-2", aliases).subscribeDurable
 * }}}
 */
final class ClassifyQueue(open: Resource[IO, StompLink], queue: String, aliases: List[AliasMapping]):
  def this(config: RabbitMqConfig, queue: String, aliases: List[AliasMapping]) =
    this(StompConnection.open(config.address.host, config.address.port, config.vhost, config.credentials.login, config.credentials.passcode).map(connection => connection: StompLink), queue, aliases)
  def subscribeDurable: Stream[IO, (Observation, IO[Unit])] = StompQueue(open, queue, decode).subscribeDurable
  private[stomp] def decode(frame: StompFrame): Option[Observation] =
    for
      route <- routed(frame.headers)
      alias <- aliases.find(item => dotted(item.topic) == dotted(route))
      json <- parse(frame.body).toOption
      ts <- json.hcursor.get[Double]("ts").toOption.filter(n => n.isFinite && n >= 0)
      value <- json.hcursor.get[Double]("value").toOption.filter(_.isFinite)
    yield
      val time = if ts > 1e10 then ts.toLong else (ts * 1000).toLong
      val event = json.hcursor.get[String]("eventId").toOption.filter(_.nonEmpty).getOrElse(s"${alias.metric}:$time:$value")
      Observation(event, alias.metric, time, value)
  private def routed(headers: Map[String, String]): Option[String] =
    val prefix = "/exchange/"
    val dest = headers.get("destination").getOrElse("")
    val slash = dest.indexOf('/', prefix.length)
    headers.get("scada-route").orElse(headers.get("routing-key")).orElse(headers.get("x-routing-key")).orElse(Option.when(dest.startsWith(prefix) && slash >= 0)(dest.substring(slash + 1)).filter(_.nonEmpty))
  private def dotted(route: String): String = route.replace('/', '.')
