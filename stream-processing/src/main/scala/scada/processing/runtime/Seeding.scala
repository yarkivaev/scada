package scada.processing.runtime

import cats.effect.{IO, Outcome}
import cats.effect.std.Queue
import fs2.Stream
import org.typelevel.log4cats.Logger
import org.typelevel.log4cats.slf4j.Slf4jLogger
import scala.concurrent.duration.*
import scada.processing.core.{MachineConfig, MachineId, Params, Reading, Timestamp}
import scada.processing.infra.checkpoint.{Checkpoint, RawReadingData}
import scada.processing.infra.config.AliasMapping

/**
 * Seamless replay-then-live readings source for one machine.
 *
 * Startup ceremony:
 *   1. Read a replay cursor derived from persisted segments — this is
 *      the replay resume point.
 *   2. Open the live MQTT subscription and start offering every
 *      reading into a bounded queue (capacity from `seeding.capacity`,
 *      default 10_000) the moment this stream is compiled. If
 *      history drain falls far behind the live feed the producer
 *      back-pressures rather than exhausting the heap.
 *   3. Fetch historical rows strictly after the watermark from
 *      the configured checkpoint readings source and emit them in timestamp order.
 * *      Dotted aliases also match slash ClickHouse topics.
 *      A hung readings fetch empties this step so live MQTT is not parked.
 *   4. Once history drains, take from the queue and keep only
 *      readings whose timestamp is strictly after the resume cursor.
 *      Later history samples must not raise that bar: a live reading
 *      after the cursor still flows even when it is not after the last
 *      replayed row.
 *
 * No explicit "switch" is needed — fs2 stream concatenation and the
 * concurrent ingest give a single uninterrupted `Stream[IO, Reading]`.
 *
 * {{{
 * Seeding(checkpoint).seed(machine, aliases, mqtt.subscribe)
 * }}}
 */
final class Seeding(checkpoint: Checkpoint, capacity: Int, stall: FiniteDuration = 60.seconds):

  private given Logger[IO] = Slf4jLogger.getLogger[IO]

  def seed(machine: MachineConfig, aliases: List[AliasMapping], live: Stream[IO, Reading]): Stream[IO, Reading] =
    Stream.eval(prepare(machine)).flatMap: (from, queue) =>
      val history = Stream.exec(logReplay(machine, from)) ++
        Stream.eval(limit(replay(checkpoint.fetchReadings, aliases, from).compile.toList, machine.id, required = false)).flatMap(Stream.emits)
      val queued = Stream.fromQueueUnterminated(queue).filter(_.timestamp.isAfter(from))
      (history ++ Stream.exec(logLive(machine)) ++ queued).concurrently(live.evalMap(queue.tryOffer(_).void))

  /** The durable RabbitMQ queue retains readings until replay is ready to process them. */
  def seedDurable(machine: MachineConfig, aliases: List[AliasMapping], live: Stream[IO,(Reading,IO[Unit])], onLive: IO[Unit]): Stream[IO,(Reading,IO[Unit])] =
    Stream.eval(resumeFrom(machine)).flatMap: from =>
      val load = limit(replay(checkpoint.fetchRequiredReadings, aliases, from).compile.toList, machine.id, required = true)
      val history = Stream.eval(retryRequired(load, machine.id)).flatMap(Stream.emits).map(_ -> IO.unit)
      val afterCursor = live.evalFilter: (reading, ack) =>
        if reading.timestamp.isAfter(from) then IO.pure(true) else ack.as(false)
      Stream.exec(logReplay(machine, from)) ++ history ++ Stream.exec(onLive *> logLive(machine)) ++ afterCursor

  private def logReplay(machine: MachineConfig, from: Timestamp): IO[Unit] =
    Logger[IO].info(s"${machine.id.raw}: replay from ts=${from.epoch}")

  private def logLive(machine: MachineConfig): IO[Unit] =
    Logger[IO].info(s"${machine.id.raw}: history drained, switching to live")

  private def retryRequired(load: IO[List[Reading]], id: MachineId): IO[List[Reading]] =
    load.handleErrorWith: error =>
      Logger[IO].warn(error)(s"${id.raw}: required history unavailable, retrying replay") *> IO.sleep(1.second) *> retryRequired(load, id)

  private def prepare(machine: MachineConfig): IO[(Timestamp, Queue[IO, Reading])] =
    for
      from  <- resumeFrom(machine)
      queue <- Queue.bounded[IO, Reading](capacity)
    yield (from, queue)

  private def resumeFrom(machine: MachineConfig): IO[Timestamp] =
    checkpoint.fetchReplayCursor(machine.id)

  private def limit(rows: IO[List[Reading]], id: MachineId, required: Boolean): IO[List[Reading]] =
    IO.racePair(rows, IO.sleep(stall)).flatMap:
      case Left((done, timer)) =>
        timer.cancel.start *> finish(done)
      case Right((worker, _)) =>
        val expired = if required then IO.raiseError(java.util.concurrent.TimeoutException(s"${id.raw}: required history drain stalled"))
                      else Logger[IO].warn(s"${id.raw}: history drain stalled, switching to live").as(Nil)
        worker.cancel.start *> expired

  private def finish(done: Outcome[IO, Throwable, List[Reading]]): IO[List[Reading]] =
    done match
      case Outcome.Succeeded(got) => got
      case Outcome.Errored(err)   => IO.raiseError(err)
      case Outcome.Canceled()     => IO.pure(Nil)
  private def replay(fetch: (List[String], Timestamp) => Stream[IO, RawReadingData], aliases: List[AliasMapping], from: Timestamp): Stream[IO, Reading] =
    fetch(topics(aliases), from)
      .flatMap(raw => Stream.fromOption(toReading(aliases, raw)))

  private def topics(aliases: List[AliasMapping]): List[String] =
    aliases.flatMap(alias => List(alias.topic, alias.topic.replace('.', '/'), alias.topic.replace('/', '.'))).distinct

  private def toReading(aliases: List[AliasMapping], raw: RawReadingData): Option[Reading] =
    aliases.find(alias => dotted(alias.topic) == dotted(raw.topic)).map: alias =>
      Reading(raw.timestamp, Params(Map(alias.metric -> raw.value)))

  private def dotted(route: String): String = route.replace('/', '.')
