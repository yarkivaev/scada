package scada.processing.runtime

import cats.effect.IO
import io.circe.Json
import io.circe.parser.parse
import java.net.URI
import java.net.http.{HttpClient,HttpRequest,HttpResponse}
import java.time.Duration
import scada.processing.infra.config.CheckpointApiConfig
import scala.concurrent.duration.*

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
  def commitHistory(body: Json): IO[Json] =
    def attempt(retries: Int): IO[Json] =
      request("POST", "/v1/history/commit", body).handleErrorWith:
        case error: HistoryHttpError if error.status < 500 => IO.raiseError(error)
        case error if retries == 0 => IO.raiseError(error)
        case _ => IO.sleep(200.millis) *> attempt(retries - 1)
    attempt(2)

  def retry[A](action: IO[A]): IO[A] = action.handleErrorWith(_=>IO.sleep(2.seconds) *> retry(action))
