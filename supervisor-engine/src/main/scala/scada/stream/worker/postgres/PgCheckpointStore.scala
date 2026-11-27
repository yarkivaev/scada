package scada.stream.worker.postgres

import cats.effect.IO
import cats.syntax.all.*
import doobie.*
import doobie.implicits.*
import io.circe.{Decoder, Encoder, Json}
import io.circe.generic.semiauto.{deriveDecoder, deriveEncoder}
import io.circe.parser.parse
import io.circe.syntax.*
import scada.stream.worker.*

final case class CheckpointConflict(task: TaskIdentity, expectedRevision: Long)
  extends RuntimeException(s"Checkpoint for $task is no longer at revision $expectedRevision")

/** Shared storage for workers. The coordinator supplies strictly increasing ownership tokens. */
final class PgCheckpointStore[S: Encoder: Decoder, O: Encoder: Decoder](xa: Transactor[IO])
    extends CheckpointStore[S, O]:
  private given CodecForTask: Encoder[TaskIdentity] = deriveEncoder
  private given DecodeTask: Decoder[TaskIdentity] = deriveDecoder
  private given EncodeVersion: Encoder[ProcessorVersion] = deriveEncoder
  private given DecodeVersion: Decoder[ProcessorVersion] = deriveDecoder
  private given EncodeId: Encoder[OutputId] = deriveEncoder
  private given DecodeId: Decoder[OutputId] = deriveDecoder
  private given EncodeOutput: Encoder[Output[O]] = deriveEncoder
  private given DecodeOutput: Decoder[Output[O]] = deriveDecoder
  private given EncodeCheckpoint: Encoder[Checkpoint[S, O]] = deriveEncoder
  private given DecodeCheckpoint: Decoder[Checkpoint[S, O]] = deriveDecoder

  /** Activate the coordinator's grant. A takeover keeps the previous checkpoint and pending output. */
  def claim(ownership: Long, initial: Checkpoint[S, O]): IO[Unit] =
    val task = initial.task
    val document = initial.asJson.noSpaces
    sql"""
      INSERT INTO stream_worker_checkpoint (task_id, input_id, run_id, ownership, revision, document)
      VALUES (${task.taskId}, ${task.inputId}, ${task.runId}, $ownership, ${initial.revision}, $document::jsonb)
      ON CONFLICT (task_id, input_id, run_id) DO UPDATE SET ownership = EXCLUDED.ownership
      WHERE stream_worker_checkpoint.ownership <= EXCLUDED.ownership
    """.update.run.transact(xa).flatMap(rows => IO.raiseWhen(rows != 1)(StaleOwnership(task, ownership)))

  def load(task: TaskIdentity, ownership: Long): IO[Checkpoint[S, O]] =
    document(task, ownership).flatMap(value => IO.fromEither(value.as[Checkpoint[S, O]]))

  override def loadCompatible(task: TaskIdentity, version: ProcessorVersion, ownership: Long)
      : IO[Checkpoint[S, O]] =
    for
      value <- document(task, ownership)
      actualTask <- IO.fromEither(value.hcursor.get[TaskIdentity]("task"))
      actualVersion <- IO.fromEither(value.hcursor.get[ProcessorVersion]("version"))
      _ <- CheckpointCompatibility.check(task, version, actualTask, actualVersion)
      checkpoint <- IO.fromEither(value.as[Checkpoint[S, O]])
    yield checkpoint

  private def document(task: TaskIdentity, ownership: Long): IO[Json] =
    sql"""
      SELECT document::text FROM stream_worker_checkpoint
      WHERE task_id = ${task.taskId} AND input_id = ${task.inputId} AND run_id = ${task.runId}
        AND ownership = $ownership
    """.query[String].option.transact(xa).flatMap:
      case Some(document) => IO.fromEither(parse(document))
      case None => IO.raiseError(StaleOwnership(task, ownership))

  def commit(ownership: Long, expectedRevision: Long, next: Checkpoint[S, O]): IO[Unit] =
    val task = next.task
    val document = next.asJson.noSpaces
    val update = sql"""
      UPDATE stream_worker_checkpoint SET revision = ${next.revision}, document = $document::jsonb
      WHERE task_id = ${task.taskId} AND input_id = ${task.inputId} AND run_id = ${task.runId}
        AND ownership = $ownership AND revision = $expectedRevision
    """.update.run
    if next.revision != expectedRevision + 1 then IO.raiseError(CheckpointConflict(task, expectedRevision))
    else
      val checked = update.flatMap:
        case 1 => ().pure[ConnectionIO]
        case _ =>
          sql"""
            SELECT ownership FROM stream_worker_checkpoint
            WHERE task_id = ${task.taskId} AND input_id = ${task.inputId} AND run_id = ${task.runId}
          """.query[Long].option.flatMap:
            case Some(active) if active == ownership =>
              CheckpointConflict(task, expectedRevision).raiseError[ConnectionIO, Unit]
            case _ => StaleOwnership(task, ownership).raiseError[ConnectionIO, Unit]
      checked.transact(xa)
