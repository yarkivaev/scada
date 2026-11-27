package scada.processing.infra.checkpoint

import io.yarkivaev.segmentation.{TaggedSegment, Timestamp}
import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import io.circe.parser.parse
import java.net.URI
import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.time.Duration
import scada.processing.core.*
import scada.processing.infra.config.ClickhouseReadingsConfig

/**
 * Decorator that overrides readings fetch with ClickHouse paging.
 */
final class ClickhouseReadingsCheckpoint(base: Checkpoint, config: ClickhouseReadingsConfig) extends Checkpoint:

  private val client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(config.timeoutSeconds.toLong))
    .build()

  def fetchReplayCursor(machine: MachineId): IO[Timestamp] =
    base.fetchReplayCursor(machine)

  def fetchPendingSegments: IO[List[PendingSegmentData]] =
    base.fetchPendingSegments

  def fetchSegment(machine: MachineId, start: Timestamp): IO[Option[TaggedSegment]] =
    base.fetchSegment(machine, start)

  def fetchReadings(topics: List[String], from: Timestamp): Stream[IO, RawReadingData] =
    if topics.isEmpty then Stream.empty
    else loop(topics, from, 0)

  private def loop(topics: List[String], from: Timestamp, offset: Int): Stream[IO, RawReadingData] =
    Stream.eval(page(topics, from, offset)).flatMap: rows =>
      if rows.isEmpty then Stream.empty
      else Stream.emits(rows) ++ loop(topics, from, offset + rows.size)

  private def page(topics: List[String], from: Timestamp, offset: Int): IO[List[RawReadingData]] =
    val query = buildQuery(topics, from, offset)
    val request = HttpRequest.newBuilder()
      .uri(URI.create(s"${config.baseUrl}/?database=${config.database}"))
      .timeout(Duration.ofSeconds(config.timeoutSeconds.toLong))
      .header("Content-Type", "text/plain")
      .POST(HttpRequest.BodyPublishers.ofString(query))
      .build()
    IO.blocking(client.send(request, HttpResponse.BodyHandlers.ofString())).flatMap: response =>
      if response.statusCode() / 100 != 2 then
        IO.raiseError(RuntimeException(s"clickhouse error ${response.statusCode()}: ${response.body()}"))
      else
        parseRows(response.body())

  private def buildQuery(topics: List[String], from: Timestamp, offset: Int): String =
    val topicsList = topics.map(quote).mkString(", ")
    s"""SELECT topic, toFloat64(toUnixTimestamp64Milli(ts))/1000.0 as ts, value
       |FROM ${config.table}
       |WHERE topic IN ($topicsList)
       |  AND ts > fromUnixTimestamp64Milli(toInt64(${from.epoch} * 1000))
       |ORDER BY ts ASC, topic ASC
       |LIMIT ${config.batchSize} OFFSET $offset
       |FORMAT JSONEachRow""".stripMargin

  private def parseRows(body: String): IO[List[RawReadingData]] =
    val lines = body.split('\n').toList.filter(_.nonEmpty)
    lines.traverse: line =>
      IO.fromEither(parse(line)).map: json =>
        val cursor = json.hcursor
        RawReadingData(
          cursor.get[String]("topic").getOrElse(""),
          Timestamp(cursor.get[Double]("ts").getOrElse(0.0)),
          cursor.get[Double]("value").getOrElse(0.0)
        )

  private def quote(value: String): String =
    s"'${value.replace("'", "''")}'"
