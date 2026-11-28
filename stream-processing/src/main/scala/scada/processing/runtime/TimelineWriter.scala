package scada.processing.runtime

import cats.effect.{IO, IOLocal}
import io.circe.{Json, Printer}
import io.circe.parser.parse
import io.circe.syntax.*
import java.net.URLEncoder
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.HexFormat
import io.yarkivaev.streamworker.{OutputId, OutputScope}
import scada.processing.infra.stomp.{StompFrame, StompSender}

/** Submits the segment wire format through the authoritative sink transaction. */
final class TimelineWriter private (
    api: HistoryClient,
    generation: String => IO[Option[Long]],
    scope: OutputScope,
    relay: Option[StompSender],
    revisionScope: IOLocal[Option[(String, String)]]
) extends StompSender:
  def atRevision[A](machine: String)(prepareAndWrite: IO[A]): IO[A] =
    revisionScope.get.flatMap:
      case Some((active, _)) if active == machine => prepareAndWrite
      case _ =>
        readRevision(machine).flatMap(revision => atExpectedRevision(machine, revision)(prepareAndWrite))

  private[runtime] def atExpectedRevision[A](machine: String, revision: String)(action: IO[A]): IO[A] =
    revisionScope.get.bracket(_ => revisionScope.set(Some((machine, revision))) *> action)(revisionScope.set)

  private[runtime] def readRevision(machine: String): IO[String] =
    val encoded = URLEncoder.encode(machine, UTF_8)
    api.request("GET", s"/v1/history/live-revision?machine=$encoded")
      .flatMap(value => IO.fromEither(value.hcursor.get[String]("revision")))

  def send(frame: StompFrame): IO[Unit] =
    for
      payload <- IO.fromEither(parse(frame.body))
      machine <- IO.fromEither(payload.hcursor.get[String]("machine"))
      owner <- generation(machine)
      id <- scope.current.map(TimelineWriter.identity(_, payload))
      _ <- applyMessage(machine, payload, id, owner, frame.headers.get("destination"))
    yield ()

  def applyMessage(machine: String, payload: Json, outputId: String, owner: Option[Long],
      destination: Option[String]): IO[Unit] =
    atRevision(machine)(commit(machine, payload, outputId, owner, destination))

  private def commit(machine: String, payload: Json, outputId: String, owner: Option[Long],
      destination: Option[String]): IO[Unit] =
    for
      current <- revisionScope.get
      revision <- IO.fromOption(current.collect { case (matching, value) if matching == machine => value })(
        IllegalStateException(s"Timeline revision is missing for $machine"))
      metadata = List("outputId" -> outputId.asJson, "revision" -> revision.asJson) ++
        owner.toList.map(value => "generation" -> value.asJson)
      answer <- api.request("POST", "/v1/history/live-apply", payload.deepMerge(Json.obj("fence" -> Json.obj(metadata*))))
      _ <- IO.raiseUnless(answer.hcursor.get[Boolean]("applied").contains(true))(
        IllegalStateException(s"Timeline sink did not confirm output $outputId"))
      after <- IO.fromEither(answer.hcursor.get[String]("revision"))
      // An idempotent retry may return the original receipt, whose revision predates this scope.
      next <- IO(BigInt(revision).max(BigInt(after)).toString)
      _ <- revisionScope.set(Some((machine, next)))
      _ <- (relay, destination) match
        case (Some(sender), Some(path)) =>
          val committed = payload.deepMerge(Json.obj("committedOutputId" -> outputId.asJson))
          val frame = StompFrame.send(path, "", committed.noSpaces)
          IO.randomUUID.flatMap(receipt => sender.send(frame.copy(headers = frame.headers.updated("receipt", receipt.toString))))
        case _ => IO.unit
    yield ()

object TimelineWriter:
  def create(api: HistoryClient, generation: String => IO[Option[Long]], scope: OutputScope,
      relay: Option[StompSender]): IO[TimelineWriter] =
    IOLocal(Option.empty[(String, String)]).map(new TimelineWriter(api, generation, scope, relay, _))

  private val canonical = Printer.noSpaces.copy(sortKeys = true)

  private[runtime] def identity(id: Option[OutputId], payload: Json): String =
    val context = id.fold(Json.Null): output =>
      val task = output.task
      Json.arr(task.taskId.asJson, task.inputId.asJson, task.runId.asJson, output.position.asJson, output.index.asJson)
    val bytes = canonical.print(Json.arr(context, payload)).getBytes(UTF_8)
    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))
