package scada.supervisor.infra.checkpoint

import cats.data.NonEmptyList
import cats.effect.IO
import fs2.Stream
import io.circe.parser.parse
import java.net.URI
import java.net.URLEncoder
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.TimeUnit
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scala.concurrent.duration.*
import scada.supervisor.core.*
import scada.supervisor.infra.config.CheckpointApiConfig

/**
 * HTTP checkpoint client against supervisor-sink /v1/checkpoint API.
 *
 * Transient connect failures and HTTP 5xx are retried. A closed site-server
 * socket must not exit the supervisor stream.
 *
 * {{{
 * SupervisorSinkCheckpoint(CheckpointApiConfig("http://site:8081", None, 10))
 * }}}
 */
final class SupervisorSinkCheckpoint(config: CheckpointApiConfig, pause: FiniteDuration = 2.seconds) extends Checkpoint:

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  private val client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(config.timeoutSeconds.toLong))
    .build()

  def fetchReplayCursor(machine: MachineId): IO[Timestamp] =
    getJson(s"/v1/checkpoint/replay-cursor?machineId=${encode(machine.raw)}")
      .map: body =>
        val cursor = body.hcursor.get[Double]("cursor").getOrElse(0.0)
        Timestamp(cursor)

  def fetchPendingSegments: IO[List[PendingSegmentData]] =
    getJson("/v1/checkpoint/pending-segments")
      .map: body =>
        val items = body.hcursor.downField("items")
          .as[List[Map[String, io.circe.Json]]]
          .getOrElse(Nil)
        items.map: item =>
          val start = Timestamp(item("start").as[Double].getOrElse(0.0))
          val end = item.get("end").flatMap(_.as[Double].toOption).map(Timestamp.apply).getOrElse(start)
          PendingSegmentData(
            MachineId(item("machine").asString.getOrElse("")),
            item("name").asString.getOrElse(""),
            start,
            end
          )

  def fetchSegment(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]] =
    getJson(s"/v1/checkpoint/segment?machineId=${encode(machine.raw)}&start=${start.epoch}")
      .map(body => body.hcursor.downField("item").focus.flatMap(decodeTagged))

  override def fetchCyclePrior(machine: MachineId, before: Timestamp, reset: List[String]): IO[List[TaggedSegment]] =
    val resetParams = reset.map(id => s"reset=${encode(id)}").mkString("&")
    getJson(s"/v1/checkpoint/cycle-prior?machineId=${encode(machine.raw)}&before=${before.epoch}&$resetParams")
      .map: body =>
        body.hcursor.downField("items").as[List[io.circe.Json]].getOrElse(Nil).flatMap(decodeTagged)

  def fetchReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData] =
    fetchRequiredReadings(topics, from).handleErrorWith: error =>
      Stream.exec(Logger[IO].warn(error)("checkpoint readings failed"))

  override def fetchRequiredReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData] =
    NonEmptyList.fromList(topics).fold(Stream.empty): topicsNel =>
      val topicParams = topicsNel.toList.map(topic => s"topic=${encode(topic)}").mkString("&")
      val path = s"/v1/checkpoint/readings?from=${from.epoch}&$topicParams"
      Stream.eval(load(path)).flatMap(Stream.emits)

  private def load(path: String): IO[List[RawReadingData]] =
    read(path).flatMap: body =>
      IO.fromEither(body.hcursor.downField("items").as[List[Map[String, io.circe.Json]]]).map: items =>
        items.map: item =>
          RawReadingData(
            item("topic").asString.getOrElse(""),
            Timestamp(item("timestamp").as[Double].getOrElse(0.0)),
            item("value").as[Double].getOrElse(0.0)
          )

  private def decodeTagged(item: io.circe.Json): Option[TaggedSegment] =
    if item.isNull then None
    else
      val cursor = item.hcursor
      val name = cursor.get[String]("name").getOrElse("")
      val startTs = Timestamp(cursor.get[Double]("start").getOrElse(0.0))
      val endTs = Timestamp(cursor.get[Double]("end").getOrElse(0.0))
      val duration = cursor.get[Double]("duration").getOrElse(0.0)
      val tags = cursor.get[List[String]]("tags").getOrElse(Nil)
      val options = cursor.get[List[String]]("options").getOrElse(Nil)
      val properties = cursor.get[Map[String, String]]("properties").getOrElse(Map.empty)
      Some(TaggedSegment(Segment(name, startTs, endTs, duration), tags, options, properties))

  private def getJson(path: String): IO[io.circe.Json] =
    read(path).handleErrorWith: err =>
      err match
        case failure: CheckpointStatus if failure.code >= 500 =>
          Logger[IO].warn(failure)(s"checkpoint request failed path=$path") *> IO.sleep(pause) *> getJson(path)
        case _: java.io.IOException =>
          Logger[IO].warn(err)(s"checkpoint request failed path=$path") *> IO.sleep(pause) *> getJson(path)
        case _ =>
          IO.raiseError(err)

  private def read(path: String): IO[io.circe.Json] =
    val request = baseRequest(path).GET().build()
    IO.fromCompletableFuture(IO.delay(
      client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
        .orTimeout(config.timeoutSeconds.toLong, TimeUnit.SECONDS)
    )).flatMap: response =>
      val code = response.statusCode()
      if code >= 500 then
        IO.raiseError(CheckpointStatus(code, path))
      else if code == 404 then
        IO.pure(io.circe.Json.obj())
      else if code / 100 != 2 then
        IO.raiseError(RuntimeException(s"checkpoint api error $code: ${response.body()}"))
      else
        IO.fromEither(parse(response.body()).left.map(err => RuntimeException(err.message)))

  private def baseRequest(path: String): HttpRequest.Builder =
    val builder = HttpRequest.newBuilder()
      .uri(URI.create(s"${config.baseUrl}$path"))
      .timeout(Duration.ofSeconds(config.timeoutSeconds.toLong))
      .header("Accept", "application/json")
    config.token match
      case Some(token) => builder.header("Authorization", s"Bearer $token")
      case None        => builder

  private def encode(value: String): String =
    URLEncoder.encode(value, StandardCharsets.UTF_8)

private final case class CheckpointStatus(code: Int, path: String)
    extends RuntimeException(s"checkpoint http $code path=$path")
