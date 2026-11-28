package scada.processing.runtime

import io.yarkivaev.segmentation.{HistoryRange, HistorySeed, HistorySegment, HistoryState, ObservedSegmentation, Reading, Segment, Tagging, Timestamp}
import cats.effect.{IO, Ref}
import cats.syntax.all.*
import fs2.Stream
import io.circe.{Json, Printer}
import io.circe.parser.parse
import io.circe.syntax.*
import io.yarkivaev.temporal.{LocalStreams, Observation, Processing, Work, Worker}
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.util.HexFormat
import io.yarkivaev.streamworker.{ProcessingError, Processor, StepResult}
import scada.processing.core.*
import io.yarkivaev.segmentation.ObservedSegmentation.{Sample, State, segment}
import scada.processing.infra.config.{AliasMapping, CheckpointApiConfig}
import scala.concurrent.duration.*

final case class HistoryPool(cursors: LocalStreams, states: Map[Long,HistoryState]):
  def expire(now: Long): HistoryPool =
    val alive = cursors.evict(now)
    copy(cursors = alive, states = states.filter((id,_) => alive.streams.exists(_.id == id)))
  def completed(stream: Long, state: HistoryState): HistoryPool =
    val advanced = cursors.copy(streams = cursors.streams.map(c => if c.id == stream then c.copy(position = state.position) else c))
    val known = states.updated(stream,state).filter((id,_) => advanced.streams.exists(_.id == id))
    val equal = known.toVector.filter((id,s) => id != stream && s == state).map(_._1)
    val merged = equal.foldLeft(advanced)((pool,id) => pool.merge(stream,id,true))
    HistoryPool(merged,known.filter((id,_) => merged.streams.exists(_.id == id)))
object LocalHistory:
  def classify(machine: MachineConfig, points: Vector[Observation], seed: Option[HistorySeed] = None,
      continuity: Vector[HistoryRange] = Vector.empty): Vector[HistorySegment] =
    ObservedSegmentation(machine.segments, machine.window, continuity).run(grouped(points), seed)

  private[runtime] final case class Calculated(segments: Vector[HistorySegment], state: Option[HistoryState])

  private given io.circe.Codec.AsObject[Sample] = io.circe.generic.semiauto.deriveCodec

  private def grouped(points: Vector[Observation]): Vector[Sample] =
    points.groupBy(_.time).toVector.sortBy(_._1).map: (time, group) =>
      Sample(time, group.map(p => p.channel -> p.value).toMap)

  private[runtime] def classifyQueued(
      input: HistoryInput, machine: MachineConfig, points: Vector[Observation],
      seed: Option[HistorySeed] = None, continuity: Vector[HistoryRange] = Vector.empty
  ): IO[Calculated] =
    val classifier = ObservedSegmentation(machine.segments, machine.window, continuity)
    val processor = new Processor[Unit, State, Sample, HistorySegment]:
      def step(config: Unit, state: State, sample: Sample)
          : Either[ProcessingError, StepResult[State, HistorySegment]] =
        val result = classifier.step(state, sample)
        Right(StepResult(result.state, result.outputs))
    val samples = grouped(points)
    input.run(processor, (), classifier.initial(seed), samples).map: result =>
      val tail = result.state.segment.map(segment)
      val state = samples.lastOption.map(last => HistoryState(last.time, result.state.parameters, tail))
      Calculated(result.outputs ++ tail, state)

  private def digest(value: Json): String =
    val text = Printer.noSpaces.copy(sortKeys = true).print(value)
    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))

  private[runtime] def commitFence(machine: MachineId, workId: String, token: String, generation: Option[Long]): Json =
    val outputId = digest(Json.arr(machine.raw.asJson, workId.asJson, token.asJson))
    val fields = ("outputId" -> outputId.asJson) :: generation.toList.map(current => "generation" -> current.asJson)
    Json.obj("fence" -> Json.obj(fields*))

  private[runtime] def contextRevision(context: Json): IO[String] =
    IO.fromOption(context.hcursor.get[String]("revision").toOption.filter(_.nonEmpty))(
      IllegalStateException("History context revision required"))

  def sources(context: Json): Vector[Json] =
    val current = context.hcursor.get[Vector[Json]]("segments").getOrElse(Vector.empty)
    def identity(row: Json) = (row.hcursor.get[String]("kind").toOption,row.hcursor.get[String]("name").toOption,row.hcursor.get[String]("start_time").toOption)
    val archived = context.hcursor.get[Vector[Json]]("annotations").getOrElse(Vector.empty).map: row =>
      val metadata = current.find(value => identity(value) == identity(row)).fold(Json.obj()): value =>
        Json.obj(Vector("tags","properties","resolved","consumed").map(key => key -> value.hcursor.downField(key).focus.getOrElse(Json.Null))*)
      row.deepMerge(metadata).deepMerge(Json.obj("_historyArchive" -> Json.True))
    (current ++ archived).distinctBy(row => (identity(row),row.hcursor.get[String]("end_time").toOption))

  def duration(segment: HistorySegment, tailEnd: Long, rightClosed: Boolean): Double =
    if !rightClosed && segment.end == tailEnd then 0.0 else (segment.end-segment.start)/1000.0

  def metadata(row: Json, key: String, fallback: Json): Json =
    row.hcursor.downField(key).focus.filterNot(_.isNull).map(v => v.asString.flatMap(t => parse(t).toOption).getOrElse(v)).getOrElse(fallback)

  /**
   * Attaches operator metadata without slicing one continuous classification.
   * A stored seam is kept when the pieces that meet there differ by name or tags,
   * or when the new class differs from those stored pieces.
   * The same state running past its last stored end stays one segment.
   */
  def overlay(result: Vector[HistorySegment], existing: Vector[Json], continuation: Boolean = false): Vector[(HistorySegment,Json)] =
    def instant(row: Json, key: String): Long = row.hcursor.get[String](key).toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)
    def mark(row: Json): (String, String) =
      val name = row.hcursor.get[String]("name").getOrElse("")
      val raw = row.hcursor.downField("tags").focus.getOrElse(Json.Null)
      (name, raw.asString.flatMap(text => parse(text).toOption).getOrElse(raw).noSpaces)
    def kept(segmentName: String, at: Long, from: Long, until: Long): Boolean =
      val ending = existing.filter(row => instant(row, "end_time") == at)
      val starting = existing.filter(row => instant(row, "start_time") == at)
      val later = existing.filter(row => instant(row, "start_time") > at && instant(row, "start_time") < until)
      val earlier = existing.filter(row => instant(row, "end_time") <= at && instant(row, "end_time") > from)
      val foreign = (ending ++ starting).exists(row => !row.hcursor.get[String]("name").toOption.contains(segmentName))
      if ending.nonEmpty && starting.nonEmpty then foreign || ending.exists(left => starting.exists(right => mark(left) != mark(right)))
      else if ending.nonEmpty then ending.exists(row => !row.hcursor.get[String]("name").toOption.contains(segmentName)) || later.exists(row => ending.exists(left => mark(left) != mark(row)))
      else starting.exists(row => !row.hcursor.get[String]("name").toOption.contains(segmentName)) || earlier.exists(row => starting.exists(right => mark(row) != mark(right)))
    val cuts = existing.flatMap: row =>
      val start = instant(row,"start_time")
      val end = instant(row,"end_time")
      if continuation && row.hcursor.get[Double]("duration").toOption.contains(0.0) then Vector(start) else Vector(start,end)
    .distinct.sorted
    result.zipWithIndex.flatMap: (segment,index) =>
      val matches = existing.filter(row => row.hcursor.get[String]("name").toOption.contains(segment.name) && ((instant(row,"start_time") < segment.end && instant(row,"end_time") > segment.start) ||
        (segment.start == segment.end && instant(row,"start_time") <= segment.start && instant(row,"end_time") >= segment.start) ||
        (instant(row,"start_time") == segment.start && instant(row,"end_time") == segment.end)))
      val current = matches.filterNot(_.hcursor.get[Boolean]("_historyArchive").getOrElse(false))
      val owners = if current.nonEmpty then current else matches
      val proposedStart = if index == 0 then owners.map(instant(_,"start_time")).minOption.fold(segment.start)(_.min(segment.start)) else segment.start
      val proposedEnd = if index == result.size-1 then owners.map(instant(_,"end_time")).maxOption.fold(segment.end)(_.max(segment.end)) else segment.end
      val blockers = existing.filter(row => !row.hcursor.get[Boolean]("_historyArchive").getOrElse(false) && !row.hcursor.get[String]("name").toOption.contains(segment.name))
      val start = blockers.filter(row => instant(row,"start_time") < segment.start && instant(row,"end_time") > proposedStart)
        .map(row => instant(row,"end_time").min(segment.start)).foldLeft(proposedStart)(_.max(_))
      val end = blockers.filter(row => instant(row,"end_time") > segment.end && instant(row,"start_time") < proposedEnd)
        .map(row => instant(row,"start_time").max(segment.end)).foldLeft(proposedEnd)(_.min(_))
      val boundaries = Vector(start) ++ cuts.filter(t => t > start && t < end && kept(segment.name, t, start, end)) ++ Vector(end)
      boundaries.sliding(2).collect:
        case Vector(a,b) =>
          val left = owners.map(instant(_,"start_time")).minOption
          val right = owners.map(instant(_,"end_time")).maxOption
          val covered = owners.filter(row => instant(row,"start_time") >= a && instant(row,"end_time") <= b)
          val inherited = owners.find(row => instant(row,"start_time") <= a && instant(row,"end_time") >= b).orElse(owners.find(row => instant(row,"start_time") <= a && instant(row,"end_time") > a)).orElse {
            if left.exists(b <= _) then owners.find(row => left.contains(instant(row,"start_time")))
            else if right.exists(a >= _) then owners.find(row => right.contains(instant(row,"end_time")))
            else None
          }.orElse(if covered.map(mark).distinct.size == 1 then covered.headOption else None).getOrElse(Json.Null)
          (segment.copy(start = a,end = b),inherited)
      .toVector

  val nativeTailProtocol = "preserve-known-suffix-v1"
  private def instant(row: Json, key: String): Long =
    row.hcursor.get[String](key).toOption.map(Instant.parse(_).toEpochMilli).getOrElse(0L)

  /** Send observed changes plus only CAS-proved exterior already present in this context. */
  def commitRows(machine: MachineConfig, result: Vector[HistorySegment], context: Json, continuation: Boolean = false): Vector[Json] =
    val current = context.hcursor.get[Vector[Json]]("segments").getOrElse(Vector.empty)
    val pageEnd = context.hcursor.downField("page").get[Long]("until").toOption
    val overlaid = overlay(result,sources(context),continuation)
    val bounded = overlaid.flatMap: (segment,inherited) =>
      val owner = current.find(row => row.hcursor.get[String]("name").toOption.contains(segment.name) &&
        instant(row,"start_time") <= segment.start && instant(row,"end_time") >= segment.end)
      val terminalAnchor = pageEnd.exists(end => segment.start == end) && owner.exists(row =>
        instant(row,"start_time") == segment.start && instant(row,"end_time") > segment.start)
      if terminalAnchor then None
      else
        val exterior = owner.filter(row => pageEnd.exists(end => instant(row,"end_time") > end) && segment.end == instant(row,"end_time"))
        val end = if exterior.nonEmpty then segment.end else pageEnd.fold(segment.end)(_.min(segment.end))
        Some((segment.copy(end = end),inherited,exterior))
    val suffixes = pageEnd.toVector.flatMap: until =>
      current.filter(row => instant(row,"end_time") > until).flatMap: owner =>
        val changed = bounded.exists((segment,_,_) => segment.start == instant(owner,"start_time") &&
          (segment.name != owner.hcursor.get[String]("name").getOrElse("") || segment.end < instant(owner,"end_time")))
        val retained = bounded.exists((_,_,proof) => proof.contains(owner))
        if !changed || retained then None
        else Some((HistorySegment(owner.hcursor.get[String]("name").getOrElse(""),until+1,instant(owner,"end_time")),owner,Some(owner)))
    val rows = bounded ++ suffixes
    rows.filter((segment,_,_) => segment.start <= segment.end).map: (segment,inherited,proof) =>
      val unchanged = proof.exists(owner => instant(owner,"start_time") == segment.start && instant(owner,"end_time") == segment.end)
      val duration = if proof.exists(_.hcursor.get[Double]("duration").toOption.contains(0.0)) then 0.0 else if unchanged then inherited.hcursor.get[Double]("duration").getOrElse(0.0) else LocalHistory.duration(segment,result.lastOption.map(_.end).getOrElse(segment.end),context.hcursor.get[Boolean]("rightClosed").getOrElse(false))
      val base = Segment(segment.name,Timestamp(segment.start/1000.0),Timestamp(segment.end/1000.0),duration)
      val tagged = Tagging().resolve(machine.tags,base)
      Json.obj("kind" -> inherited.hcursor.get[String]("kind").toOption.map(Json.fromString).getOrElse(Json.fromString("phase")),"name" -> Json.fromString(segment.name),
        "start_time" -> Json.fromString(Instant.ofEpochMilli(segment.start).toString),
        "end_time" -> Json.fromString(Instant.ofEpochMilli(segment.end).toString),
        "duration" -> Json.fromDoubleOrNull(base.duration),
        "consumed" -> Json.fromBoolean(inherited.hcursor.get[Boolean]("consumed").getOrElse(true)),
        "resolved" -> Json.fromBoolean(inherited.hcursor.get[Boolean]("resolved").getOrElse(tagged.tags.nonEmpty)),
        "tags" -> LocalHistory.metadata(inherited,"tags",Json.arr(tagged.tags.map(Json.fromString)*)),
        "options" -> LocalHistory.metadata(inherited,"options",Json.arr(tagged.options.map(Json.fromString)*)),
        "properties" -> LocalHistory.metadata(inherited,"properties",Json.obj(tagged.properties.toVector.map((k,v) => k -> Json.fromString(v))*))).deepMerge(proof.fold(Json.obj())(owner => Json.obj("preserveSuffix" -> owner)))

/** Durable HTTP work queue is local to the receiving edge. Failed requests retry without acknowledging input. */
final class LocalHistory(
    config: CheckpointApiConfig,
    machine: MachineConfig,
    input: HistoryInput,
    replication: Option[HistoryReplication] = None,
    generation: Option[Long] = None
):
  private val transport=HistoryClient(config)
  import transport.{request,retry}
  private val encoded = URLEncoder.encode(machine.id.raw,StandardCharsets.UTF_8)
  def configure(aliases: List[AliasMapping]): IO[Unit] =
    val topics = aliases.map(a => Json.obj("topic" -> Json.fromString(a.topic),"channel" -> Json.fromString(a.metric)))
    retry(request("POST","/v1/history/config",Json.obj("machine" -> Json.fromString(machine.id.raw),"topics" -> Json.arr(topics*)))).flatMap: response =>
      IO.raiseUnless(response.hcursor.get[String]("nativeTailProtocol").toOption.contains(LocalHistory.nativeTailProtocol))(new IllegalStateException("History receiver does not preserve known segment suffixes"))
  def accept(reading: Reading): IO[Unit] =
    val observations = reading.params.values.toVector.map: (channel,value) =>
      Json.obj("eventId" -> Json.fromString(s"${machine.id.raw}:$channel:${reading.timestamp.millis}:$value"),
        "channel" -> Json.fromString(channel),"time" -> Json.fromLong(reading.timestamp.millis),"value" -> Json.fromDoubleOrNull(value))
    retry(request("POST","/v1/history/observations",Json.obj("machine" -> Json.fromString(machine.id.raw),"observations" -> Json.arr(observations*)))).void
  def process: Stream[IO,Unit] =
    Stream.eval(Ref.of[IO,HistoryPool](HistoryPool(LocalStreams.empty(machine.window.toLong*2000,10000),Map.empty))).flatMap: pool =>
      Stream.repeatEval(IO.monotonic.flatMap(now => pool.update(_.expire(now.toMillis))) *> retry(request("GET",s"/v1/history/work?machine=$encoded"))).flatMap: body =>
        val work = body.hcursor.get[Vector[Json]]("items").getOrElse(Vector.empty)
        Stream.emits(work).covary[IO].evalMap(raw => run(raw,pool).attempt.flatTap(_.left.toOption.traverse_(error => IO.println(s"Local history work deferred: ${error.getMessage}")))).collect { case Right(_) => () }.append(Stream.sleep_[IO](1.second))
  private def run(raw: Json, pool: Ref[IO,HistoryPool]): IO[Unit] =
    val cursor = raw.hcursor
    for
      id <- IO.fromEither(cursor.get[String]("id"))
      token <- IO.fromEither(cursor.get[String]("token"))
      from <- IO.fromEither(cursor.get[Long]("from"))
      until <- IO.fromEither(cursor.get[Long]("until"))
      now <- IO.monotonic.map(_.toMillis)
      routed <- pool.modify: previous =>
        val routed = previous.cursors.evict(now).route(Observation(id,"work",from,0),now)
        // Cursors are a bounded cache; receiver work remains durable when a cursor is evicted.
        val kept = routed.state.copy(streams = routed.state.streams.takeRight(64))
        (HistoryPool(kept,previous.states.filter((id,_) => kept.streams.exists(_.id == id))),routed.work.copy(from = from,until = until))
      calculated <- Ref.of[IO,Option[HistoryState]](None)
      snapshot <- Ref.of[IO,Json](Json.Null)
      ports = new Processing[IO,HistorySegment]:
        def context(work: Work): IO[Option[Vector[Observation]]] =
          val claim = s"&workId=${URLEncoder.encode(id,StandardCharsets.UTF_8)}&workToken=${URLEncoder.encode(token,StandardCharsets.UTF_8)}"
          request("GET",s"/v1/history/context?machine=$encoded&from=$from&until=$until&paddingMs=${machine.window.toLong*2000}$claim" + raw.hcursor.get[Long]("cursor").toOption.fold("")(value => s"&cursor=$value") + raw.hcursor.get[Long]("end").toOption.fold("")(value => s"&end=$value")).flatTap(snapshot.set).flatMap: response =>
            if !response.hcursor.get[Boolean]("available").getOrElse(false) then IO.pure(None)
            else IO.fromEither(response.hcursor.get[Vector[Json]]("items").flatMap(_.traverse: item =>
              val p = item.hcursor
              for
                event <- p.get[String]("eventId")
                channel <- p.get[String]("channel")
                time <- p.get[Long]("time")
                value <- p.get[Double]("value")
              yield Observation(event,channel,time,value)
            )).map(Some(_))
        def classify(work: Work, points: Vector[Observation]): IO[Vector[HistorySegment]] =
          snapshot.get.flatMap: context =>
            val initial = context.hcursor.downField("initial")
            val seed = for
              time <- initial.get[Long]("time").toOption
              values <- initial.get[Map[String,Double]]("values").toOption
            yield
              val prior = initial.downField("segment")
              val segment = for
                name <- prior.get[String]("name").toOption
                start <- prior.get[String]("start_time").toOption.flatMap(t => scala.util.Try(Instant.parse(t).toEpochMilli).toOption)
              yield HistorySegment(name,start,time)
              HistorySeed(time,values,segment)
            val continuity = context.hcursor.get[Vector[Json]]("continuity").getOrElse(Vector.empty).flatMap: row =>
              for
                from <- row.hcursor.get[Long]("from").toOption
                until <- row.hcursor.get[Long]("until").toOption
              yield HistoryRange(from,until)
            LocalHistory.contextRevision(context) *>
              LocalHistory.classifyQueued(input, machine, points, seed, continuity)
                .flatTap(result => calculated.set(result.state)).map(_.segments)
        def commit(work: Work, result: Vector[HistorySegment]): IO[Unit] =
          snapshot.get.flatMap: context =>
            val rows = LocalHistory.commitRows(machine,result,context,raw.hcursor.get[Long]("cursor").toOption.isDefined)
            val claim = context.hcursor.downField("context").focus.getOrElse(Json.obj()).deepMerge(Json.obj(
              "nativeTailMode" -> Json.fromString(LocalHistory.nativeTailProtocol),
              "revision" -> context.hcursor.downField("revision").focus.getOrElse(Json.Null),
              "workToken" -> Json.fromString(token)
            )).deepMerge(LocalHistory.commitFence(machine.id, id, token, generation))
            val payload = Json.obj("machine" -> Json.fromString(machine.id.raw), "workId" -> Json.fromString(id),
              "segments" -> Json.arr(rows*), "context" -> claim)
            transport.commitHistory(payload, replication).flatMap: response =>
              IO.unlessA(response.hcursor.get[Boolean]("applied").contains(true))(calculated.set(None))
        // The receiver owns work retirement. Unavailable context yields no verified proposal.
        def acknowledge(work: Work): IO[Unit] = IO.unit
      _ <- Worker(ports).run(routed).guarantee(pool.update(p => p.copy(cursors = p.cursors.acknowledge(routed.id))))
      result <- calculated.get
      _ <- pool.update: previous =>
        val completed = result.fold(previous)(previous.completed(routed.streamId,_))
        completed.copy(cursors = completed.cursors.acknowledge(routed.id))
    yield ()
