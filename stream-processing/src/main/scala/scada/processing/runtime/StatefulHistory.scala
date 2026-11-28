package scada.processing.runtime

import cats.effect.IO
import cats.syntax.all.*
import fs2.Stream
import io.circe.{Decoder, Encoder, Json}
import io.circe.syntax.*
import io.yarkivaev.temporal.Observation
import java.net.URLEncoder
import java.nio.charset.StandardCharsets.UTF_8
import java.util.concurrent.atomic.AtomicInteger
import scada.processing.core.MachineId
import scada.processing.infra.config.AliasMapping
import scala.concurrent.duration.*

object StatefulHistory:
  final case class Page[S](state: S, rows: Vector[Json], at: Option[Long])

  private final case class Claim(id: String, token: String, from: Long, until: Long, cursor: Option[Long], end: Option[Long])
      derives Decoder

/** Executes bounded, stateful classifier pages with the receiver's work claim and revision. */
final class StatefulHistory[S: Encoder](
    api: HistoryClient,
    machine: MachineId,
    paddingMs: Long,
    classifierKey: String,
    initial: S,
    decodeState: Json => IO[S],
    replay: (Vector[Observation], S, Int) => IO[StatefulHistory.Page[S]],
    replication: Option[HistoryReplication] = None,
    generation: Option[Long] = None
):
  import StatefulHistory.*
  private val scale = AtomicInteger(0)
  private val supportedScales = Set(1, 1000)
  private def encode(value: String): String = URLEncoder.encode(value, UTF_8)
  private val encoded = encode(machine.raw)

  def configure(aliases: List[AliasMapping]): IO[Unit] =
    val topics = aliases.map(alias => Json.obj("topic" -> alias.topic.asJson, "channel" -> alias.metric.asJson))
    val body = Json.obj("machine" -> machine.raw.asJson, "topics" -> Json.arr(topics*), "classifierKey" -> classifierKey.asJson)
    api.retry(api.request("POST", "/v1/history/config", body)).flatMap: response =>
      val protocol = response.hcursor.get[String]("classifierProtocol").toOption
      val unit = response.hcursor.get[Int]("timeScale").toOption
      IO.fromOption(unit.filter(supportedScales).filter(_ => protocol.contains("stateful-correction-v1")))(
        IllegalStateException("Stateful history protocol required")).flatMap(value => IO(scale.set(value)))

  def process: Stream[IO, Unit] =
    Stream.repeatEval(api.retry(api.request("GET", s"/v1/history/work?machine=$encoded"))).flatMap: response =>
      Stream.eval(IO.fromEither(response.hcursor.get[Vector[Json]]("items"))).flatMap: work =>
        val jobs = work.headOption.fold(Stream.emit(()).covary[IO]): next =>
          val run = IO.fromEither(next.as[Claim]).flatMap(execute)
          Stream.eval(run.attempt.flatTap(_.left.toOption.traverse_(error =>
            IO.println(s"History classifier work deferred: ${Option(error.getMessage).getOrElse(error.toString)}")))).collect { case Right(_) => () }
        jobs ++ Stream.sleep_[IO](1.second)

  private def observations(context: Json, claim: Claim, unit: Int): IO[Vector[Observation]] =
    val metadata = context.hcursor.downField("context")
    val valid = metadata.get[String]("classifierKey").toOption.contains(classifierKey) &&
      metadata.get[String]("workId").toOption.contains(claim.id) &&
      metadata.get[String]("workToken").toOption.contains(claim.token) &&
      metadata.get[Int]("timeScale").toOption.getOrElse(1) == unit
    IO.raiseUnless(valid)(IllegalStateException("Mismatched classifier history context")) *>
      IO.fromEither(context.hcursor.get[Vector[Json]]("items").flatMap(_.traverse: item =>
        val point = item.hcursor
        for
          event <- point.get[String]("eventId")
          channel <- point.get[String]("channel")
          time <- point.get[Long]("time")
          value <- point.get[Double]("value")
        yield Observation(event, channel, time, value)
      )).flatMap: values =>
        IO.raiseWhen(values.size > 10000)(IllegalStateException("Unbounded classifier history context")).as(values)

  private def seed(context: Json, continuation: Boolean): IO[S] =
    context.hcursor.downField("classifierSeed").focus.filterNot(_.isNull) match
      case None if continuation => IO.raiseError(IllegalStateException("Durable classifier continuation state required"))
      case None => IO.pure(initial)
      case Some(value) => decodeState(value.hcursor.downField("state").focus.getOrElse(Json.Null))

  private def path(claim: Claim, unit: Int): String =
    s"/v1/history/context?machine=$encoded&from=${claim.from}&until=${claim.until}&paddingMs=${paddingMs * unit}" +
      s"&classifierKey=${encode(classifierKey)}&workId=${encode(claim.id)}&workToken=${encode(claim.token)}" +
      claim.cursor.fold("")(value => s"&cursor=$value") + claim.end.fold("")(value => s"&end=$value")

  private def execute(claim: Claim): IO[Unit] =
    val unit = scale.get()
    api.request("GET", path(claim, unit)).flatMap: context =>
      // Only the receiver retires work, as part of the commit. Missing context leaves the claim available.
      IO.whenA(context.hcursor.get[Boolean]("available").contains(true)):
        for
          points <- observations(context, claim, unit)
          revision <- LocalHistory.contextRevision(context)
          start <- seed(context, claim.cursor.isDefined)
          page <- replay(points, start, unit)
          _ <- commit(context, claim, page, revision)
        yield ()

  private def commit(context: Json, claim: Claim, page: Page[S], revision: String): IO[Unit] =
    val checkpoint = page.at.fold(Json.obj()): at =>
      Json.obj("checkpoint" -> Json.obj("key" -> classifierKey.asJson, "at" -> at.asJson, "state" -> page.state.asJson))
    val metadata = context.hcursor.downField("context").focus.getOrElse(Json.obj()).deepMerge(Json.obj(
      "revision" -> revision.asJson, "workToken" -> claim.token.asJson, "replace" -> Json.True
    )).deepMerge(checkpoint).deepMerge(LocalHistory.commitFence(machine, claim.id, claim.token, generation))
    val payload = Json.obj("machine" -> machine.raw.asJson, "workId" -> claim.id.asJson,
      "segments" -> Json.arr(page.rows*), "context" -> metadata)
    api.commitHistory(payload, replication).void
