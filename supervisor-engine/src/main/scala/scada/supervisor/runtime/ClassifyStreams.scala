package scada.supervisor.runtime

import cats.effect.{IO, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.circe.Json
import io.yarkivaev.temporal.{Conflict, Cursor, History, LocalStreams, Observation}
import java.time.Instant
import scada.supervisor.core.MachineConfig

/**
 * Machine AMQP classification with independent event-time cursors.
 * Telemetry stays in memory; Postgres only stores cursor metadata.
 *
 * {{{
 * ClassifyStreams.start(machine, seed, announce).flatMap(_.accept(point))
 * }}}
 */
final class ClassifyStreams(machine: MachineConfig, state: Ref[IO, StreamState], ports: ClassifyPorts, watermark: Option[Long]):
  def consume(input: Stream[IO, Observation]): Stream[IO, Unit] = input.evalMap(accept)
  def cursors: IO[Vector[Cursor]] = state.get.map(_.pool.cursors.streams)
  def accept(point: Observation): IO[Unit] =
    for
      now <- ports.clock
      routed <- state.modify(current => ClassifyStreams.route(current, point, now, machine.window.toLong * 2000))
      _ <- IO.whenA(routed.changed)(publish(routed.cursor))
      snapshot <- state.get
      _ <- ports.persist(snapshot.pool)
    yield ()
  private def publish(cursor: Cursor): IO[Unit] =
    state.get.flatMap: current =>
      val points = ClassifyHistory.collected(current.tapes.getOrElse(cursor.id, History.empty))
      val result = LocalHistory.classify(machine, points)
      val until = points.map(_.time).maxOption.getOrElse(0L)
      val from = points.map(_.time).minOption.getOrElse(0L)
      val existing = current.stored.filter(row => ClassifyStreams.overlaps(row, from, until))
      val slack = machine.window.toLong * 2000
      val historical = watermark.exists(end => cursor.position + slack < end)
      val context = Json.obj("segments" -> Json.arr(existing*), "page" -> Json.obj("until" -> Json.fromLong(until)), "rightClosed" -> Json.fromBoolean(historical))
      val page = ClassifyHistory.published(machine, existing, result, context)
      ports.announce(page, historical)

final case class ClassifyPorts(persist: HistoryPool => IO[Unit], announce: (Vector[Json], Boolean) => IO[Unit], clock: IO[Long] = IO.realTime.map(_.toMillis))
final case class StreamState(pool: HistoryPool, tapes: Map[Long, History], stored: Vector[Json])
final case class RoutedPoint(cursor: Cursor, changed: Boolean)

object ClassifyStreams:
  def start(machine: MachineConfig, seed: Vector[Json], announce: (Vector[Json], Boolean) => IO[Unit]): IO[ClassifyStreams] =
    open(machine, seed, ClassifyPorts(_ => IO.unit, announce))
  def open(machine: MachineConfig, seed: Vector[Json], ports: ClassifyPorts, watermark: Option[Long] = None, initial: Option[HistoryPool] = None): IO[ClassifyStreams] =
    val pool = initial.getOrElse(HistoryPool(LocalStreams.empty(machine.window.toLong * 2000, 10000), Map.empty))
    Ref.of[IO, StreamState](StreamState(pool, Map.empty, seed)).map(ClassifyStreams(machine, _, ports, watermark))
  private[runtime] def route(current: StreamState, point: Observation, now: Long, maxGap: Long): (StreamState, RoutedPoint) =
    val gap = if current.pool.cursors.maxGap > 0 then current.pool.cursors.maxGap else maxGap
    val idle = current.pool.cursors.idleTimeout
    val evicted = current.pool.expire(now)
    val routed = evicted.cursors.copy(maxGap = gap, idleTimeout = idle).route(point, now)
    val kept = routed.state.copy(streams = routed.state.streams.takeRight(64))
    val pool = HistoryPool(kept, evicted.states.filter((id, _) => kept.streams.exists(_.id == id)))
    val history = current.tapes.getOrElse(routed.stream.id, History.empty)
    val next = history.accept(point, Conflict.first)
    val tapes = current.tapes.filter((id, _) => kept.streams.exists(_.id == id)).updated(routed.stream.id, next)
    (StreamState(pool, tapes, current.stored), RoutedPoint(routed.stream, next.rows != history.rows))
  private[runtime] def overlaps(row: Json, from: Long, until: Long): Boolean =
    val start = row.hcursor.get[String]("start_time").toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
    val end = row.hcursor.get[String]("end_time").toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
    start <= until && end >= from
