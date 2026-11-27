package scada.processing.infra.stomp

import io.yarkivaev.segmentation.{Segment, SplitEntry, SplitPieces, TaggedSegment, Timestamp}
import cats.effect.{IO, Ref}
import io.circe.parser.parse as parseJson
import munit.CatsEffectSuite
import scada.processing.core.*
import scada.processing.core.Segments as CoreSegments
import scada.processing.infra.state.Segments
import scala.collection.immutable.SortedMap
import scala.concurrent.duration.*

/**
 * Unit coverage for [[StompSegments]] publish-after-merge: heartbeat
 * upserts must announce preserved operator tags on the wire.
 */
final class StompSegmentsSpec extends CatsEffectSuite:

  private def tagged(name: String, start: Double, end: Double, duration: Double,
      tags: List[String] = Nil, options: List[String] = Nil, properties: Map[String, String] = Map.empty): TaggedSegment =
    TaggedSegment(Segment(name, Timestamp(start), Timestamp(end), duration), tags, options, properties)

  private def recording: IO[(StompSender, Ref[IO, List[String]])] =
    Ref.of[IO, List[String]](Nil).map: bodies =>
      val sender = new StompSender:
        def send(frame: StompFrame): IO[Unit] =
          bodies.update(_ :+ frame.body)
      (sender, bodies)

  private def store: IO[CoreSegments[IO]] =
    Ref
      .of[IO, Map[MachineId, SortedMap[Timestamp, TaggedSegment]]](Map.empty)
      .map(Segments[IO](_))

  test("upsert publishes merged tags after empty-tag heartbeat"):
    for
      base            <- store
      (sender, bodies) <- recording
      decorator        = StompSegments(base, sender, "/exchange/scada.segments")
      mid              = MachineId("icht3")
      _               <- decorator.upsert(mid, tagged("off", 100, 100, 0, tags = List("metal_ready")))
      _               <- bodies.set(Nil)
      _               <- decorator.upsert(mid, tagged("off", 100, 200, 100, options = List("a", "b")))
      published       <- bodies.get
    yield
      assertEquals(published.length, 1, "heartbeat should publish exactly one frame")
      val json = parseJson(published.head).toOption.get
      val tags = json.hcursor.downField("tags").as[List[String]].toOption.get
      assertEquals(tags, List("metal_ready"), "wire payload dropped preserved operator tags")

  test("upsert after resolve publishes preserved options and resolved"):
    for
      base            <- store
      (sender, bodies) <- recording
      decorator        = StompSegments(base, sender, "/exchange/scada.segments")
      mid              = MachineId("icht3")
      _               <- decorator.upsert(mid, tagged("off", 50, 50, 0, options = List("a", "b")))
      _               <- decorator.resolve(mid, Segment("off", Timestamp(50.0), Timestamp(50.0), 0.0), List("inspection"), Nil, Map.empty)
      _               <- bodies.set(Nil)
      _               <- decorator.upsert(mid, tagged("off", 50, 80, 30, options = List("a", "b", "c")))
      published       <- bodies.get
    yield
      val json = parseJson(published.head).toOption.get
      val tags = json.hcursor.downField("tags").as[List[String]].toOption.get
      val opts = json.hcursor.downField("options").as[List[String]].toOption.get
      val resolved = json.hcursor.downField("resolved").as[Boolean].toOption.get
      assertEquals(tags, List("inspection"), "resolved tags missing on heartbeat wire")
      assertEquals(opts, List("a", "b"), "resolved options should stay on wire for re-edit")
      assertEquals(resolved, true, "tagged heartbeat must keep resolved true")

  test("pending heartbeats are published at most once per heartbeat interval"):
    for
      base             <- store
      (sender, bodies) <- recording
      clock            <- Ref.of[IO, Long](1_000L)
      decorator         = StompSegments(
                            base,
                            sender,
                            "/exchange/scada.segments",
                            1.second,
                            clock.get
                          )
      mid               = MachineId("icht2")
      _                <- decorator.upsert(mid, tagged("off", 10, 10, 0))
      _                <- decorator.upsert(mid, tagged("off", 10, 20, 0))
      _                <- clock.set(1_500L)
      _                <- decorator.upsert(mid, tagged("off", 10, 30, 0))
      _                <- clock.set(2_100L)
      _                <- decorator.upsert(mid, tagged("off", 10, 40, 0))
      published        <- bodies.get
    yield assertEquals(published.length, 2, "pending STOMP publish was not throttled")

  test("replace publishes one split-family body"):
    for
      base             <- store
      (sender, bodies) <- recording
      decorator         = StompSegments(base, sender, "/exchange/scada.segments")
      mid               = MachineId("icht-2")
      origin            = Timestamp(100.0)
      rows              = SplitPieces.materialize(
                            Segment("off", origin, Timestamp(400.0), 300.0),
                            List(
                              SplitEntry(origin, Timestamp(250.0), "inspection"),
                              SplitEntry(Timestamp(250.0), Timestamp(400.0), "")
                            )
                          )
      _                <- decorator.replace(mid, origin, Timestamp(400.0), rows)
      published        <- bodies.get
    yield
      assertEquals(published.length, 1, "split replace published more than one frame")
      val json = parseJson(published.head).toOption.get
      val kind = json.hcursor.downField("type").as[String].toOption.get
      assertEquals(kind, "split-family", "replace did not publish split-family")

  test("replace publishes split boundaries in millis and durations in seconds"):
    for
      base             <- store
      (sender, bodies) <- recording
      decorator         = StompSegments(base, sender, "/exchange/scada.segments")
      mid               = MachineId("icht-millis")
      origin            = Timestamp(100.0)
      rows              = SplitPieces.materialize(
                            Segment("off", origin, Timestamp(250.0), 0.0),
                            List(
                              SplitEntry(origin, Timestamp(180.0), "inspection"),
                              SplitEntry(Timestamp(180.0), Timestamp(250.0), "maintenance", open = true)
                            )
                          )
      _                <- decorator.replace(mid, origin, Timestamp(250.0), rows)
      published        <- bodies.get
    yield
      val json = parseJson(published.head).toOption.get
      val pieces = json.hcursor.downField("pieces").as[List[io.circe.Json]].toOption.get
      val summary = pieces.map: piece =>
        val cursor = piece.hcursor
        (
          cursor.downField("name").as[String].toOption.get,
          cursor.downField("start").as[Long].toOption.get,
          cursor.downField("end").as[Long].toOption.get,
          cursor.downField("duration").as[Double].toOption.get,
          cursor.downField("tags").as[List[String]].toOption,
          cursor.downField("properties").as[Map[String, String]].toOption.get
        )
      assertEquals(
        (
          published.length,
          json.hcursor.downField("type").as[String].toOption.get,
          json.hcursor.downField("origin").as[Long].toOption.get,
          summary
        ),
        (
          1,
          "split-family",
          100000L,
          List(
            ("off", 100000L, 180000L, 80.0, Some(List("inspection")), Map("split_of" -> "100000")),
            ("off", 180000L, 250000L, 0.0, Some(List("maintenance")), Map("split_of" -> "100000"))
          )
        )
      )

  test("heartbeat after a split publishes the open tail rather than the closed first piece"):
    for
      base             <- store
      (sender, bodies) <- recording
      decorator         = StompSegments(base, sender, "/exchange/scada.segments")
      mid               = MachineId("icht-beat")
      origin            = Timestamp(100.0)
      rows              = SplitPieces.materialize(
                            Segment("off", origin, Timestamp(250.0), 0.0),
                            List(
                              SplitEntry(origin, Timestamp(200.0), "inspection"),
                              SplitEntry(Timestamp(200.0), Timestamp(250.0), "maintenance", open = true)
                            )
                          )
      _                <- decorator.replace(mid, origin, Timestamp(250.0), rows)
      _                <- bodies.set(Nil)
      _                <- decorator.upsert(mid, tagged("off", 100, 330, 0, tags = List("furnace_fault")))
      published        <- bodies.get
      first            <- decorator.find(mid, origin)
    yield
      val json = parseJson(published.head).toOption.get
      val cursor = json.hcursor
      assertEquals(
        (
          published.length,
          cursor.downField("type").as[String].toOption.get,
          cursor.downField("start").as[Long].toOption.get,
          cursor.downField("end").as[Long].toOption.get,
          cursor.downField("duration").as[Double].toOption.get,
          cursor.downField("tags").as[List[String]].toOption,
          first.map(_.segment.end.epoch)
        ),
        (1, "segment", 200000L, 330000L, 0.0, Some(List("maintenance")), Some(200.0))
      )
