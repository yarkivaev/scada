package scada.processing.runtime

import cats.effect.{IO, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.circe.{Decoder, Encoder, Json}
import io.circe.parser.parse
import io.yarkivaev.streamworker.{Checkpoint, CheckpointStore, Delivery, Processor, ProcessorVersion, StreamWorker, TaskIdentity}
import scada.processing.infra.config.RabbitMqConfig
import scada.processing.infra.stomp.{StompConnection, StompFrame, StompLink}
import scala.concurrent.duration.*

/** Supplies one bounded history page as an ordered input to the normal worker. */
trait HistoryInput:
  def run[C, S, I: Encoder: Decoder, O](processor: Processor[C, S, I, O], config: C, initial: S, events: Vector[I])
      : IO[HistoryInput.Result[S, O]]

object HistoryInput:
  final case class Result[S, O](state: S, outputs: Vector[O])

  def rabbit(config: RabbitMqConfig): HistoryInput = new HistoryInput:
    def run[C, S, I: Encoder: Decoder, O](processor: Processor[C, S, I, O], rules: C, initial: S, events: Vector[I])
        : IO[Result[S, O]] =
      StompConnection.open(config.address.host, config.address.port, config.vhost,
        config.credentials.login, config.credentials.passcode).use { link =>
        for
          id <- IO.randomUUID.map(_.toString)
          queue = s"scada.history.input.$id"
          task = TaskIdentity("history", queue, id)
          version = ProcessorVersion("history-input/1", "page", "session/1")
          store <- CheckpointStore.session(Checkpoint[S, O](task, version, 0L, None, initial, Vector.empty), 1L)
          outputs <- Ref.of[IO, Vector[O]](Vector.empty)
          worker = StreamWorker(processor, store, (_, output) => outputs.update(_ :+ output.value))
          result <- worker.run(task, version, rules, 1L)(_ => page(link, queue, events))
          rows <- outputs.get
        yield Result(result.state, rows)
      }

  // The upstream work claim or unacknowledged outer observation owns durability.
  // If this connection fails, its queue is deleted and the caller retries the whole bounded page.
  private def page[I: Encoder: Decoder](link: StompLink, queue: String, events: Vector[I]): Stream[IO, Delivery[I]] =
    val subscribe = StompFrame("SUBSCRIBE", Map(
      "destination" -> s"/queue/$queue", "id" -> "history", "ack" -> "client-individual",
      "prefetch-count" -> "1", "exclusive" -> "true", "auto-delete" -> "true", "durable" -> "false",
      "receipt" -> "history-subscribe"), "")
    val batches = events.grouped(128).toVector
    val input = Stream.emits(batches.zipWithIndex).covary[IO].flatMap: (batch, index) =>
      val position = index.toLong * 128L
      val command = Json.obj("position" -> Json.fromLong(position),
        "events" -> Json.arr(batch.map(Encoder[I].apply)*))
      Stream.eval(send(link, queue, command) *> message(link)).flatMap: (body, ack) =>
        val decoded = body.hcursor.get[Long]("position").flatMap: actual =>
          if actual == position then body.hcursor.get[Vector[I]]("events")
          else Left(io.circe.DecodingFailure(s"Expected history input position $position", Nil))
        Stream.eval(IO.fromEither(decoded)).flatMap: values =>
          if values.size != batch.size then Stream.raiseError[IO](IllegalStateException("Incomplete history input batch"))
          else Stream.emits(values.zipWithIndex).map: (event, offset) =>
            Delivery(position + offset, event, if offset == values.size - 1 then ack else IO.unit)
    val end = (send(link, queue, Json.obj("end" -> Json.fromInt(events.size))) *> message(link)).flatMap: (body, ack) =>
      IO.raiseUnless(body.hcursor.get[Int]("end").contains(events.size))(
        IllegalStateException("History input ended without its page marker")) *> ack
    Stream.exec(link.send(subscribe)) ++ input ++ Stream.exec(end)

  private def send(link: StompLink, queue: String, body: Json): IO[Unit] =
    val frame = StompFrame.send(s"/amq/queue/$queue", "", body.noSpaces)
    link.send(frame.copy(headers = frame.headers.updated("persistent", "false")))

  private def message(link: StompLink): IO[(Json, IO[Unit])] =
    link.receive.timeout(10.seconds).flatMap:
      case Some(frame) if frame.command == "MESSAGE" =>
        (IO.fromEither(parse(frame.body)), IO.fromOption(frame.headers.get("ack"))(
          IllegalStateException("Missing history delivery acknowledgement"))).mapN { (body, id) =>
          (body, link.send(StompFrame("ACK", Map("id" -> id), "")))
        }
      case Some(frame) => IO.raiseError(IllegalStateException(s"Unexpected history input frame ${frame.command}"))
      case None => IO.raiseError(IllegalStateException("RabbitMQ closed the history input before the end marker"))
