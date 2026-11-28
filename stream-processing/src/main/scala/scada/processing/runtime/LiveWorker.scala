package scada.processing.runtime

import cats.effect.IO
import cats.effect.std.Semaphore
import fs2.Stream
import fs2.concurrent.SignallingRef
import io.yarkivaev.streamworker.{Delivery, Output, OutputScope, Processor, ProcessorVersion, StreamWorker}
import scala.concurrent.duration.*

object LiveWorker:
  final case class Replay[S, E](active: S => Boolean, complete: S => IO[E])
  final case class Watchdog[S, E](deadline: S => Option[Long], changed: (S, S) => Boolean, expired: Long => E)

/** Serializes input, replay handoff, timeouts, and side effects under one worker's ownership. */
final class LiveWorker[C, S, E, O](
    processor: Processor[C, S, E, O],
    config: C,
    version: ProcessorVersion,
    binding: WorkerStores.Binding[S, O],
    publish: O => IO[Unit],
    outputs: Option[OutputScope] = None
):
  import LiveWorker.*
  private val WorkerStores.Binding(store, task, ownership) = binding
  private val current = store.load(task, ownership)
  private val worker = StreamWorker(processor, store, (_: Long, output: Output[O]) =>
    val write = publish(output.value)
    outputs.fold(write)(_.within(output.id)(write)))

  private def submit(event: E) = worker.run(task, version, config, ownership): cursor =>
    // Allocate the receipt position from the worker checkpoint. Broker receipt IDs may be connection-local.
    Stream.eval(IO(Math.addExact(cursor.getOrElse(0L), 1L))).map(position => Delivery(position, event, IO.unit))

  def run(
      readings: IO[Unit] => Stream[IO, (E, IO[Unit])],
      sideEffects: Stream[IO, IO[Unit]],
      replay: Replay[S, E],
      watchdog: Watchdog[S, E],
      scheduleOnStart: Boolean
  ): IO[Unit] =
    for
      lock <- Semaphore[IO](1)
      deadline <- SignallingRef[IO, Option[Long]](None)
      _ <- worker.run(task, version, config, ownership)(_ => Stream.empty)
      arm = (state: S) => deadline.set(watchdog.deadline(state))
      accept = (event: E, ack: IO[Unit]) =>
        lock.permit.use { _ =>
          for
            before <- current
            next <- submit(event)
            _ <- IO.whenA(!replay.active(next.state) && watchdog.changed(before.state, next.state))(arm(next.state))
          yield replay.active(before.state)
        }.flatMap: replaying =>
          // Archive records have no broker receipt. Live ACKs follow the completed worker step.
          IO.unlessA(replaying)(ack)
      ready = lock.permit.use: _ =>
        current.flatMap: saved =>
          if replay.active(saved.state) then
            replay.complete(saved.state).flatMap(submit).flatMap(next => arm(next.state))
          else IO.unit
      timers = deadline.discrete.changes.switchMap:
        case None => Stream.empty
        case Some(until) =>
          Stream.eval(IO.realTime.flatMap(now => IO.sleep(math.max(0L, until - now.toMillis).millis))).as(until)
      _ <- IO.whenA(scheduleOnStart)(current.flatMap(saved => arm(saved.state)))
      input = readings(ready).evalMap { case (event, ack) => accept(event, ack) }
      live = (input ++ Stream.exec(ready)).concurrently(sideEffects.evalMap(action => lock.permit.use(_ => action)))
        .concurrently(timers.evalMap(at => lock.permit.use(_ => submit(watchdog.expired(at))).void))
      _ <- live.compile.drain
    yield ()
