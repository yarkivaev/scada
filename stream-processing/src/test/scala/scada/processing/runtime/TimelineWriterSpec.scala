package scada.processing.runtime

import cats.effect.{IO, Ref, Resource}
import com.sun.net.httpserver.HttpServer
import io.circe.Json
import io.circe.parser.parse
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.ConcurrentLinkedQueue
import munit.CatsEffectSuite
import scala.jdk.CollectionConverters.*
import io.yarkivaev.streamworker.{OutputId, OutputScope, TaskIdentity}
import scada.processing.infra.config.CheckpointApiConfig
import scada.processing.infra.stomp.{StompFrame, StompSender}

final class TimelineWriterSpec extends CatsEffectSuite:
  private def endpoint(applied: ConcurrentLinkedQueue[Json], committedRevision: Int => Int = count => 42 + count,
      path: String => Unit = _ => ()): Resource[IO, HistoryClient] =
    Resource.make(IO.blocking {
      val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
      server.createContext("/v1/history", exchange => {
        try
          val get = exchange.getRequestMethod == "GET"
          if !get then
            path(exchange.getRequestURI.getPath)
            val json = parse(new String(exchange.getRequestBody.readAllBytes(), UTF_8)).toOption.get
            applied.add(json)
          val response = if get then """{"revision":"42"}"""
                         else s"""{"applied":true,"revision":"${committedRevision(applied.size())}"}"""
          val bytes = response.getBytes(UTF_8)
          exchange.sendResponseHeaders(200, bytes.length)
          exchange.getResponseBody.write(bytes)
        finally exchange.close()
      })
      server.start()
      server
    })(server => IO.blocking(server.stop(0))).map(server =>
      HistoryClient(CheckpointApiConfig(s"http://127.0.0.1:${server.getAddress.getPort}", None, 2)))

  test("publishes only confirmed bodies and derives repeatable child identities"):
    val applied = new ConcurrentLinkedQueue[Json]()
    val task = TaskIdentity("machine", "input", "run")
    val id = OutputId(task, 10, 2)
    val original = """{"machine":"machine","type":"segment","duration":0}"""
    val reordered = """{"duration":0,"type":"segment","machine":"machine"}"""
    val altered = """{"duration":1,"type":"segment","machine":"machine"}"""
    endpoint(applied).use: client =>
      for
        scope <- OutputScope.create
        relayed <- Ref.of[IO, List[Json]](Nil)
        relay = new StompSender:
          def send(frame: StompFrame): IO[Unit] = IO {
            assert(applied.size() > 0, "relay must follow database commit")
            parse(frame.body).toOption.get
          }.flatMap(json => relayed.update(_ :+ json))
        writer <- TimelineWriter.create(client, _ => IO.pure(Some(21L)), scope, Some(relay))
        _ <- scope.within(id)(writer.atRevision("machine")(
          writer.send(StompFrame.send("/exchange/segments", "", original)) *>
            writer.send(StompFrame.send("/exchange/segments", "", altered))))
        _ <- scope.within(id)(writer.send(StompFrame.send("/exchange/segments", "", reordered)))
        broadcasts <- relayed.get
      yield
        val fences = applied.iterator().asScala.toList.map(_.hcursor.downField("fence"))
        val ids = fences.map(_.get[String]("outputId").toOption.get)
        assertEquals(fences.map(_.get[String]("revision").toOption), List(Some("42"), Some("43"), Some("42")))
        assertEquals(fences.map(_.get[Long]("generation").toOption), List.fill(3)(Some(21L)))
        assertEquals(ids.head, ids(2))
        assertNotEquals(ids.head, ids(1))
        assertEquals(broadcasts.map(_.hcursor.get[String]("committedOutputId").toOption.get), ids)
        assert(broadcasts.forall(!_.hcursor.downField("fence").succeeded))


  test("a receipt from an earlier revision never rewinds the current write fence"):
    val applied = new ConcurrentLinkedQueue[Json]()
    val payload = Json.obj("machine" -> Json.fromString("machine"))
    endpoint(applied, count => if count == 1 then 12 else 43).use: client =>
      for
        scope <- OutputScope.create
        writer <- TimelineWriter.create(client, _ => IO.pure(None), scope, None)
        _ <- writer.atRevision("machine")(
          writer.applyMessage("machine", payload, "old", None, None) *>
            writer.applyMessage("machine", payload, "next", None, None))
      yield
        assertEquals(applied.iterator().asScala.toList.map(_.hcursor.downField("fence").get[String]("revision")),
          List(Right("42"), Right("42")))

  test("replicated live writes request the outbox in the commit and skip direct publication"):
    val applied = new ConcurrentLinkedQueue[Json]()
    val paths = new ConcurrentLinkedQueue[String]()
    val payload = Json.obj("machine" -> Json.fromString("machine"))
    val relay = new StompSender:
      def send(frame: StompFrame): IO[Unit] = IO.raiseError(IllegalStateException("direct relay"))
    endpoint(applied, path = value => { val _ = paths.add(value) }).use: client =>
      for
        scope <- OutputScope.create
        writer <- TimelineWriter.create(client, _ => IO.pure(Some(21L)), scope, Some(relay), transactionalReplica = true)
        _ <- writer.applyMessage("machine", payload, "live", Some(21L), Some("/exchange/segments/phase"))
      yield
        assertEquals(paths.iterator().asScala.toList, List("/v1/history/live-apply-outbox"))
        val replication = applied.peek().hcursor.downField("replication")
        assertEquals(replication.get[String]("exchange"), Right("segments"))
        assertEquals(replication.get[String]("routingKey"), Right("phase"))
        assertEquals(replication.get[Long]("epoch"), Right(21L))
