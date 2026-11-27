package scada.supervisor.infra.stomp

import cats.effect.{IO,Resource}
import fs2.Stream
import java.util.concurrent.TimeoutException
import scala.concurrent.duration.*
/** Pre-bound durable input; ACK before downstream so prefetch-1 cannot stall the broker. */
final class StompQueue[A](open: Resource[IO,StompLink], queue: String, decode: StompFrame => Option[A], idle: FiniteDuration = 30.seconds):
  def subscribe: Stream[IO,A] = receive((value, ack) => Stream.exec(ack) ++ Stream.emit(value))

  def subscribeDurable: Stream[IO,(A,IO[Unit])] = receive((value, ack) => Stream.emit((value, ack)))

  private def receive[B](message: (A,IO[Unit]) => Stream[IO,B]): Stream[IO,B] =
    Stream.resource(open).flatMap: connection =>
      val subscription = StompFrame("SUBSCRIBE",Map("destination"->s"/amq/queue/$queue","id"->"supervisor-input","ack"->"client-individual","prefetch-count"->"1"),"")
      Stream.eval(connection.send(subscription)) >>
        Stream.repeatEval(connection.receive).unNoneTerminate.flatMap: frame =>
          if frame.command == "ERROR" then Stream.raiseError[IO](IllegalStateException(frame.body))
          else if frame.command != "MESSAGE" then Stream.empty
          else
            val id = frame.headers.getOrElse("ack",throw IllegalArgumentException("Missing STOMP ack id"))
            decode(frame) match
              case Some(value) =>
                message(value, connection.send(StompFrame("ACK",Map("id"->id),"")))
              case None => Stream.exec(connection.send(StompFrame("NACK",Map("id"->id,"requeue"->"false"),"")))
        .timeoutOnPullTo(idle, Stream.raiseError[IO](TimeoutException("stomp idle")))
    .handleErrorWith:
      case _: TimeoutException => Stream.sleep_[IO](10.millis)
      case _ => Stream.sleep_[IO](1.second)
    .repeat
