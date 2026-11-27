package scada.processing.runtime

import io.yarkivaev.segmentation.{HistorySegment, Segment, TaggedSegment, Timestamp}
import cats.effect.{IO, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import io.yarkivaev.temporal.{Conflict, History, Observation}
import java.time.Instant
import scada.processing.core.{MachineConfig, MachineId}
import scada.processing.infra.stomp.SplitFamily

/**
 * Event-time machine classification from an AMQP classify stream.
 * First-wins on eventId and on (channel, time). Late points overlay
 * already committed segments and keep operator tags and cuts.
 *
 * {{{
 * ClassifyHistory.start(machine, seed, announce).flatMap(_.accept(point))
 * }}}
 */
final class ClassifyHistory(
    machine: MachineConfig,
    tape: Ref[IO, History],
    stored: Ref[IO, Vector[Json]],
    announce: Vector[Json] => IO[Unit]
):
  def consume(input: Stream[IO, Observation]): Stream[IO, Unit] = input.evalMap(accept)
  def accept(point: Observation): IO[Unit] =
    tape.modify: history =>
      val next = history.accept(point, Conflict.first)
      (next, next.rows != history.rows)
    .flatMap(changed => if changed then publish else IO.unit)
  def classified: IO[Vector[HistorySegment]] =
    tape.get.map(history => LocalHistory.classify(machine, ClassifyHistory.collected(history)))
  def marked: IO[Vector[Json]] =
    (tape.get, stored.get).mapN: (history, existing) =>
      val result = LocalHistory.classify(machine, ClassifyHistory.collected(history))
      LocalHistory.overlay(result, existing).map(ClassifyHistory.frame)
  private def publish: IO[Unit] =
    (tape.get, stored.get).flatMapN: (history, existing) =>
      val points = ClassifyHistory.collected(history)
      val result = LocalHistory.classify(machine, points)
      val until = points.map(_.time).maxOption.getOrElse(0L)
      val context = Json.obj("segments" -> Json.arr(existing*), "page" -> Json.obj("until" -> Json.fromLong(until)), "rightClosed" -> Json.False)
      announce(ClassifyHistory.published(machine, existing, result, context))

object ClassifyHistory:
  def start(machine: MachineConfig, seed: Vector[Json], announce: Vector[Json] => IO[Unit]): IO[ClassifyHistory] =
    (Ref.of[IO, History](History.empty), Ref.of[IO, Vector[Json]](seed)).mapN(ClassifyHistory(machine, _, _, announce))
  def collected(history: History): Vector[Observation] =
    history.rows.iterator.flatMap((_, group) => group.valuesIterator).toVector
  def frame(segment: HistorySegment, inherited: Json): Json =
    Json.obj(
      "kind" -> Json.fromString("phase"),
      "name" -> Json.fromString(segment.name),
      "start_time" -> Json.fromString(Instant.ofEpochMilli(segment.start).toString),
      "end_time" -> Json.fromString(Instant.ofEpochMilli(segment.end).toString),
      "duration" -> Json.fromDoubleOrNull(LocalHistory.duration(segment, segment.end, false)),
      "consumed" -> Json.fromBoolean(inherited.hcursor.get[Boolean]("consumed").getOrElse(true)),
      "resolved" -> Json.fromBoolean(inherited.hcursor.get[Boolean]("resolved").getOrElse(true)),
      "tags" -> LocalHistory.metadata(inherited, "tags", Json.arr()),
      "properties" -> LocalHistory.metadata(inherited, "properties", Json.obj())
    )
  def published(machine: MachineConfig, existing: Vector[Json], result: Vector[HistorySegment], context: Json): Vector[Json] =
    val overlaid = LocalHistory.overlay(result, LocalHistory.sources(context))
    val rows = LocalHistory.commitRows(machine, result, context).filterNot(row => nested(row, existing))
    rows ++ families(machine.id.raw, existing, overlaid)
  def families(machine: String, existing: Vector[Json], overlaid: Vector[(HistorySegment, Json)]): Vector[Json] =
    existing.flatMap: row =>
      val start = instant(row, "start_time")
      val end = instant(row, "end_time")
      val kids = overlaid.flatMap:
        case (segment, inherited) if ClassifyHistory.covers(segment, start, end) =>
          Vector((segment.copy(start = segment.start.max(start), end = segment.end.min(end)), inherited))
        case _ => Vector.empty
      if kids.size < 2 then Vector.empty
      else
        val pieces = kids.map { case (child, inherited) => tagged(child, inherited) }.toList
        io.circe.parser.parse(SplitFamily.json(MachineId(machine), Timestamp(start / 1000.0), pieces)).toOption.toVector
  private[runtime] def covers(segment: HistorySegment, start: Long, end: Long): Boolean =
    if segment.start == segment.end then segment.start >= start && segment.start <= end
    else segment.start < end && segment.end > start
  private def nested(row: Json, existing: Vector[Json]): Boolean =
    val start = instant(row, "start_time")
    val end = instant(row, "end_time")
    existing.exists(owner => instant(owner, "start_time") < start && instant(owner, "end_time") >= end)
  private def tagged(segment: HistorySegment, inherited: Json): TaggedSegment =
    val tags = LocalHistory.metadata(inherited, "tags", Json.arr()).asArray.getOrElse(Vector.empty).flatMap(_.asString).toList
    val properties = LocalHistory.metadata(inherited, "properties", Json.obj()).asObject.map(_.toMap.flatMap((key, value) => value.asString.map(key -> _))).getOrElse(Map.empty)
    TaggedSegment(Segment(segment.name, Timestamp(segment.start / 1000.0), Timestamp(segment.end / 1000.0), LocalHistory.duration(segment, segment.end, true)), tags, Nil, properties)
  private def instant(row: Json, key: String): Long =
    row.hcursor.get[String](key).toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
