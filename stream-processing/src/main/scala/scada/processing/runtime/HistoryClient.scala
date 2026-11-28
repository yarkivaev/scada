package scada.processing.runtime

import cats.effect.IO
import io.circe.{Json, Printer}
import io.circe.parser.parse
import java.net.URI
import java.net.http.{HttpClient,HttpRequest,HttpResponse}
import java.time.Duration
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.HexFormat
import scada.processing.infra.config.{AppConfig, CheckpointApiConfig}
import scala.concurrent.duration.*

final case class HistoryReplication(exchange: String, routingKey: String, epoch: Option[Long]):
  private[runtime] def json: Json = Json.obj("exchange" -> Json.fromString(exchange), "routingKey" -> Json.fromString(routingKey))
    .deepMerge(epoch.fold(Json.obj())(value => Json.obj("epoch" -> Json.fromLong(value))))

object HistoryReplication:
  private[runtime] def forWriter(config: AppConfig, grant: Option[LeaseGrant]): Option[HistoryReplication] =
    WriterLease.publication(config.leaseUrl, grant, config.writerEpoch).flatMap: epoch =>
      config.connectivity.rabbitmq.destinations.segments.map(fromDestination(_, epoch))

  def fromDestination(destination: String, epoch: Option[Long]): HistoryReplication =
    destination.split("/", 4).toList match
      case "" :: "exchange" :: exchange :: Nil if exchange.nonEmpty => HistoryReplication(exchange, "", epoch)
      case "" :: "exchange" :: exchange :: key :: Nil if exchange.nonEmpty => HistoryReplication(exchange, key, epoch)
      case _ => throw IllegalArgumentException(s"History replica destination must be a RabbitMQ exchange: ${destination}")

final case class HistoryHttpError(path: String, status: Int, code: Option[String])
  extends RuntimeException(s"history API ${path.takeWhile(_ != '?')} status $status${code.fold("")(value => s" ($value)")}")

/** Shared authenticated local history transport; failed requests never retire server work. */
final class HistoryClient(config: CheckpointApiConfig):
  private val client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(config.timeoutSeconds.toLong)).build()
  def request(method: String,path: String,body: Json=Json.Null): IO[Json] =
    val builder=HttpRequest.newBuilder(URI.create(config.baseUrl.stripSuffix("/")+path))
      .timeout(Duration.ofSeconds(config.timeoutSeconds.toLong)).header("Content-Type","application/json")
    config.token.foreach(token=>builder.header("Authorization",s"Bearer $token"))
    val request=if method=="GET" then builder.GET().build() else builder.POST(HttpRequest.BodyPublishers.ofString(body.noSpaces)).build()
    IO.blocking(client.send(request,HttpResponse.BodyHandlers.ofString())).flatMap: response =>
      val decoded = parse(response.body())
      if response.statusCode()/100!=2 then
        val code = decoded.toOption.flatMap(json =>
          json.hcursor.downField("error").get[String]("code").toOption.orElse(json.hcursor.get[String]("code").toOption))
        IO.raiseError(HistoryHttpError(path, response.statusCode(), code))
      else IO.fromEither(decoded.left.map(error=>RuntimeException(error.message)))
  /** Retry a lost commit response with the same fenced body and receipt identity. */
  def commitHistory(body: Json, replication: Option[HistoryReplication] = None): IO[Json] =
    val (path, payload) = replication.fold(("/v1/history/commit", body)): target =>
      ("/v1/history/commit-outbox-v2", body.deepMerge(Json.obj("replication" -> target.json)))
    def attempt(retries: Int): IO[Json] =
      request("POST", path, payload).handleErrorWith:
        case error: HistoryHttpError if error.status < 500 => IO.raiseError(error)
        case error if retries == 0 => IO.raiseError(error)
        case _ => IO.sleep(200.millis) *> attempt(retries - 1)
    attempt(2)

  def retry[A](action: IO[A]): IO[A] = action.handleErrorWith(_=>IO.sleep(2.seconds) *> retry(action))

object HistoryClient:
  /** Stable fingerprint for classifier configuration and claimed work. */
  def fingerprint(value: Json): String =
    val bytes = Printer.noSpaces.copy(sortKeys = true).print(value).getBytes(UTF_8)
    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
