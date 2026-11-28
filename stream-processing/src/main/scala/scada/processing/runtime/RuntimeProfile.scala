package scada.processing.runtime

import io.yarkivaev.segmentation.{Reading, ReadingOverride, Tagging}
import cats.effect.IO
import fs2.Stream
import io.circe.Json
import io.yarkivaev.streamworker.OutputScope
import scada.processing.core.{MachineConfig, Segments}
import scada.processing.infra.checkpoint.Checkpoint
import scada.processing.infra.config.{AliasMapping, AppConfig, CheckpointApiConfig, ConfigProfile}
import scada.processing.infra.state.SegmentStatePolicy
import scada.processing.infra.stomp.SegmentWirePolicy

/** Site overrides for configured machine modes. The default runs the shared classifier. */
trait RuntimeProfile:
  def configuration: ConfigProfile = ConfigProfile.default
  def classifyReading(reading: Reading): Option[ReadingOverride] = None
  def tagging: Tagging = Tagging()
  def statePolicy: SegmentStatePolicy = SegmentStatePolicy.default
  def wirePolicy: SegmentWirePolicy = SegmentWirePolicy.default
  def historyProtocols: Vector[String] = Vector("preserve-known-suffix-v1")
  def decorate(config: AppConfig, segments: Segments[IO]): IO[Segments[IO]] = IO.pure(segments)
  def live(config: AppConfig, machine: MachineConfig, aliases: List[AliasMapping], segments: Segments[IO],
      checkpoint: Option[Checkpoint], seeding: Option[Seeding], outputs: Option[OutputScope], database: Option[WorkerDatabase]): Option[Stream[IO, Unit]] = None
  def decisions(config: AppConfig, machine: MachineConfig, segments: Segments[IO]): Stream[IO, Unit] = Stream.empty
  def history(machine: MachineConfig, aliases: List[AliasMapping], api: CheckpointApiConfig,
      announce: Vector[Json] => IO[Unit], generation: Option[Long], input: HistoryInput): Stream[IO, Unit] =
    Stream.raiseError[IO](IllegalArgumentException(s"Unsupported history mode for ${machine.id.raw}"))

object RuntimeProfile:
  val default: RuntimeProfile = new RuntimeProfile {}
