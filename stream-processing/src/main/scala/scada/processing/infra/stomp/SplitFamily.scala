package scada.processing.infra.stomp

import io.yarkivaev.segmentation.{TaggedSegment, Timestamp}
import io.circe.Json
import io.circe.syntax.*
import scada.processing.core.MachineId
/**
 * One STOMP body that replaces a whole split family. The sink applies
 * it in a single transaction so a boundary edit cannot leave the
 * previous intermediate rows on the timeline.
 *
 * {{{
 * SplitFamily.json(machine, origin, pieces)
 * }}}
 */
object SplitFamily:
  def json(machine: MachineId, origin: Timestamp, pieces: List[TaggedSegment]): String =
    val rows = pieces.map: piece =>
      Json.obj(
        "name"       -> Json.fromString(piece.segment.name),
        "start"      -> Json.fromLong(piece.segment.start.millis),
        "end"        -> Json.fromLong(piece.segment.end.millis),
        "duration"   -> Json.fromDoubleOrNull(piece.segment.duration),
        "tags"       -> listOrNull(piece.tags),
        "properties" -> mapOrNull(piece.properties),
        "kind"       -> Json.fromString("phase")
      )
    Json.obj(
      "type"    -> Json.fromString("split-family"),
      "machine" -> Json.fromString(machine.raw),
      "origin"  -> Json.fromLong(origin.millis),
      "pieces"  -> Json.fromValues(rows)
    ).noSpaces

  private def listOrNull(values: List[String]): Json =
    if values.isEmpty then Json.Null else values.asJson

  private def mapOrNull(values: Map[String, String]): Json =
    if values.isEmpty then Json.Null else values.asJson
