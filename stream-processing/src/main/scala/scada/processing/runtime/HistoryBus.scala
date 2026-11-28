package scada.processing.runtime

import io.yarkivaev.segmentation.{Segment, TaggedSegment, Timestamp}
import io.circe.Json
import io.circe.parser.parse
import java.time.Instant
import scada.processing.core.*
import scada.processing.infra.stomp.SegmentMessage

/** Converts an AMQP classification result to the fenced timeline wire format. */
object HistoryBus:
  /** Bus envelope for one committed row, with start and end kept as exact epoch millis. */
  def message(machine: MachineId, row: Json): Json =
    val cursor = row.hcursor
    val name = required(cursor, "name")
    val start = Instant.parse(required(cursor, "start_time")).toEpochMilli
    val end = Instant.parse(required(cursor, "end_time")).toEpochMilli
    val duration = cursor.get[Double]("duration").getOrElse(0.0)
    val tagged = TaggedSegment(
      Segment(name, Timestamp(start / 1000.0), Timestamp(end / 1000.0), duration),
      strings(cursor.downField("tags").focus.getOrElse(Json.Null)),
      strings(cursor.downField("options").focus.getOrElse(Json.Null)),
      props(cursor.downField("properties").focus.getOrElse(Json.Null))
    )
    SegmentMessage.segment(machine, tagged).json.deepMerge(Json.obj(
      "start" -> Json.fromLong(start),
      "end" -> Json.fromLong(end),
      "kind" -> Json.fromString(cursor.get[String]("kind").getOrElse("phase"))
    ))

  private def required(cursor: io.circe.HCursor, key: String): String =
    cursor.get[String](key).fold(error => throw IllegalArgumentException(s"History segment missing $key: ${error.getMessage}"), identity)

  private def strings(value: Json): List[String] =
    val parsed = value.asString.flatMap(text => parse(text).toOption).getOrElse(value)
    parsed.asArray.fold(List.empty[String])(_.flatMap(_.asString).toList)

  private def props(value: Json): Map[String, String] =
    val parsed = value.asString.flatMap(text => parse(text).toOption).getOrElse(value)
    parsed.asObject.fold(Map.empty[String, String])(_.toIterable.flatMap((key, item) => item.asString.map(key -> _)).toMap)
