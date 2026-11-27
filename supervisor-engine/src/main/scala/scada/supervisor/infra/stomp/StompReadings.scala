package scada.supervisor.infra.stomp

import cats.effect.{IO, Resource}
import fs2.Stream
import io.circe.parser.parse
import scada.supervisor.core.*
import scada.supervisor.infra.config.{AliasMapping,RabbitMqConfig}

/** One pre-bound durable AMQP queue preserves parameter/rise order. Slash aliases match dotted routing keys. */
final class StompReadings(open: Resource[IO,StompLink], queue: String, aliases: List[AliasMapping]):
  def this(config: RabbitMqConfig, queue: String, aliases: List[AliasMapping]) =
    this(StompConnection.open(config.address.host,config.address.port,config.vhost,config.credentials.login,config.credentials.passcode)
      .map(connection => connection: StompLink),queue,aliases)
  def subscribeDurable: Stream[IO,(Reading,IO[Unit])] = StompQueue(open,queue,decode).subscribeDurable
  private[stomp] def decode(frame: StompFrame): Option[Reading] =
    for
      route <- routed(frame.headers)
      alias <- aliases.find(item => dotted(item.topic) == dotted(route))
      json <- parse(frame.body).toOption
      ts <- json.hcursor.get[Double]("ts").toOption.filter(n => n.isFinite && n >= 0)
      value <- json.hcursor.get[Double]("value").toOption.filter(_.isFinite)
    yield Reading(Timestamp(if ts > 1e10 then ts/1000 else ts),Params(Map(alias.metric->value)))
  private def routed(headers: Map[String, String]): Option[String] =
    val prefix = "/exchange/"
    val dest = headers.get("destination").getOrElse("")
    val slash = dest.indexOf('/', prefix.length)
    headers.get("scada-route").orElse(headers.get("routing-key")).orElse(headers.get("x-routing-key")).orElse(Option.when(dest.startsWith(prefix) && slash >= 0)(dest.substring(slash + 1)).filter(_.nonEmpty))
  private def dotted(route: String): String = route.replace('/', '.')
