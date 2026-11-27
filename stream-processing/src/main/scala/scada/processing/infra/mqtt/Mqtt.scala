package scada.processing.infra.mqtt

import cats.effect.{IO, Resource}
import fs2.Stream
import io.circe.parser.parse as parseJson
import java.util.concurrent.LinkedBlockingQueue
import org.eclipse.paho.client.mqttv3.{
  IMqttDeliveryToken,
  MqttCallbackExtended,
  MqttClient,
  MqttConnectOptions,
  MqttMessage as PahoMqttMessage
}
import org.slf4j.LoggerFactory
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scada.processing.core.*
import scada.processing.infra.config.{AliasMapping, MqttConfig}
import scala.concurrent.duration.*

/**
 * MQTT reading stream for one machine. Subscribes to the topics
 * listed in `aliases`, parses `{ts, value}` JSON payloads, and emits
 * one single-metric [[Reading]] per message.
 *
 * A dropped broker connection ends the inner session; [[Sessions]]
 * opens a new client and resubscribes.
 *
 * {{{
 * Mqtt(mqttConfig, aliases).subscribe
 * }}}
 */
final class Mqtt(config: MqttConfig, aliases: List[AliasMapping]):

  private given Logger[IO] = Slf4jLogger.getLogger[IO]
  private val callbackLog  = LoggerFactory.getLogger(getClass)

  def subscribe: Stream[IO, Reading] =
    Sessions(1.second).repeat(IO(session))

  private def session: Stream[IO, Reading] =
    val queue  = LinkedBlockingQueue[Option[Reading]]()
    val topics = aliases.map(_.topic)
    val client = Resource.make(
      Logger[IO].info(s"MQTT connecting to ${config.host}:${config.port} topics=${topics.size}") *>
        connect(topics, queue)
    )(c =>
      Logger[IO].info("MQTT disconnecting") *>
        IO.blocking(c.disconnect()).attempt.void *> IO.blocking(c.close()).attempt.void
    )
    Stream.resource(client) >> Stream.repeatEval(IO.interruptible(queue.take())).unNoneTerminate

  private def connect(topics: List[String], queue: LinkedBlockingQueue[Option[Reading]]): IO[MqttClient] = IO.blocking:
    val client = MqttClient(s"tcp://${config.host}:${config.port}", config.clientId)
    val opts = Mqtt.options(config)
    client.setCallback(new MqttCallbackExtended:
      def connectComplete(reconnect: Boolean, serverURI: String): Unit =
        if reconnect && topics.nonEmpty then client.subscribe(topics.toArray, topics.map(_ => 1).toArray)
      def connectionLost(cause: Throwable): Unit =
        val reason = Option(cause).flatMap(e => Option(e.getMessage)).getOrElse("unknown")
        callbackLog.warn("MQTT connection lost for {}: {}", config.clientId, reason)
        queue.put(None)
      def messageArrived(topic: String, message: PahoMqttMessage): Unit =
        val payload = String(message.getPayload)
        reading(topic, payload) match
          case Some(r) => queue.put(Some(r))
          case None    => callbackLog.warn("dropping MQTT message on {}: payload did not match {{ts, value}}: {}", topic, payload)
      def deliveryComplete(token: IMqttDeliveryToken): Unit = ()
    )
    client.connect(opts)
    if topics.nonEmpty then client.subscribe(topics.toArray, topics.map(_ => 1).toArray)
    client

  private def reading(topic: String, payload: String): Option[Reading] =
    for
      metric  <- aliases.find(_.topic == topic).map(_.metric)
      json    <- parseJson(payload).toOption
      rawTs   <- json.hcursor.downField("ts").as[Double].toOption
      value   <- json.hcursor.downField("value").as[Double].toOption
    yield
      val epochSeconds = if rawTs > 1e10 then rawTs / 1000.0 else rawTs
      Reading(Timestamp(epochSeconds), Params(Map(metric -> value)))

object Mqtt:
  private[mqtt] def options(config: MqttConfig): MqttConnectOptions =
    val options = MqttConnectOptions()
    options.setAutomaticReconnect(false)
    options.setCleanSession(true)
    options.setKeepAliveInterval(60)
    config.username.foreach(options.setUserName)
    config.password.foreach(value => options.setPassword(value.toCharArray))
    options
