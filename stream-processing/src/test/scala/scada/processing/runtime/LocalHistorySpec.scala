package scada.processing.runtime

import cats.effect.unsafe.implicits.global
import io.yarkivaev.temporal.Observation
import scada.processing.core.*
class LocalHistorySpec extends munit.FunSuite:
  val machine = MachineConfig(MachineId("m"),List(SegmentDef("heat",Condition.Above("power",5)),SegmentDef("off",Condition.Below("power",5))),Nil,15)
  test("late heating divides off interval using only local neighbours") {
    val points = Vector(Observation("a","power",0,0),Observation("b","power",1000,10),Observation("c","power",2000,0),Observation("d","power",3000,0))
    val rows = LocalHistory.classify(machine,points)
    assertEquals(rows.map(_.name),Vector("off","heat","off"))
    assertEquals(rows.map(_.start),Vector(0L,1000L,2000L))
  }
  test("maxGap splits equal states rather than merging across missing history") {
    val rows = LocalHistory.classify(machine,Vector(Observation("a","power",0,0),Observation("b","power",31000,0)))
    assertEquals(rows,Vector(HistorySegment("off",0,0),HistorySegment("off",31000,31000)))
  }

  test("finite replay closes a phase at its last sample on a class change") {
    val points = Vector(Observation("a","power",0,0),Observation("b","power",1000,0),Observation("c","power",2000,10),Observation("d","power",3000,10))
    assertEquals(LocalHistory.classify(machine,points),Vector(HistorySegment("off",0,1000),HistorySegment("heat",2000,3000)))
  }

  test("bounded replay preserves seed parameters, observed bounds and exact positions") {
    val start = 9007199254700001L
    val seed = HistorySeed(start, Map("power" -> 0.0, "current" -> 5.0),
      Some(HistorySegment("off", start - 1000, start)))
    val points = Vector(Observation("heat","power",start + 32001,10), Observation("off","power",start + 1,0))
    val continuity = Vector(HistoryRange(start, start + 32001))
    val result = LocalHistory.replay(machine, points, "revision", "work", Some(seed), continuity).unsafeRunSync()
    assertEquals(result.segments, Vector(
      HistorySegment("off", start - 1000, start + 1),
      HistorySegment("heat", start + 32001, start + 32001)
    ))
    assertEquals(result.state, Some(HistoryState(start + 32001, Map(
      "power" -> (start + 32001, 10.0), "current" -> (start, 5.0)), result.segments.lastOption)))
  }

  test("overlay splits old annotated off around heat and inherits expanded pieces") {
    import io.circe.Json
    val old = Json.obj("kind" -> Json.fromString("phase"), "name" -> Json.fromString("off"),
      "start_time" -> Json.fromString("1970-01-01T00:00:00Z"), "end_time" -> Json.fromString("1970-01-01T00:00:10Z"),
      "tags" -> Json.fromString("[\"repair\"]"), "properties" -> Json.fromString("{\"operator\":\"yes\"}"))
    val result = LocalHistory.overlay(Vector(HistorySegment("off",2000,4000),HistorySegment("heat",4000,6000),HistorySegment("off",6000,8000)),Vector(old))
    assertEquals(result.map(_._1.start),Vector(0L,4000L,6000L))
    assertEquals(result.last._1.end,10000L)
    assertEquals(result.head._2.hcursor.get[String]("name").toOption,Some("off"))
    assertEquals(result(1)._2,Json.Null)
  }

  test("overlay keeps operator tags on a zero-width off that lands on a stored end") {
    import io.circe.Json
    val old = Json.obj("name" -> Json.fromString("off"),
      "start_time" -> Json.fromString("1970-01-01T00:00:00Z"), "end_time" -> Json.fromString("1970-01-01T00:00:08Z"),
      "tags" -> Json.arr(Json.fromString("ремонт-β")))
    val inherited = LocalHistory.overlay(Vector(HistorySegment("off",0,3000),HistorySegment("heat",3000,8000),HistorySegment("off",8000,8000)),Vector(old)).last._2
    assertEquals(LocalHistory.metadata(inherited,"tags",Json.Null),Json.arr(Json.fromString("ремонт-β")),"zero-width off at a stored end dropped operator tags")
  }

  test("multi-channel context survives unclassified prefix and stale channel clears after gap") {
    val m = machine.copy(segments = List(SegmentDef("heat",Condition.And(Condition.Above("power",5),Condition.Above("current",5)))))
    val points = Vector(Observation("a","power",0,10),Observation("b","current",1000,10))
    assertEquals(LocalHistory.classify(m,points).map(_.name),Vector("heat"))
    assertEquals(LocalHistory.classify(m,Vector(points.head,points.last.copy(time = 31000))).size,0)
  }
  test("adjacent same-kind segment does not inherit annotation across its boundary") {
    import io.circe.Json
    val old = Json.obj("name" -> Json.fromString("off"),"start_time" -> Json.fromString("1970-01-01T00:00:00Z"),"end_time" -> Json.fromString("1970-01-01T00:00:10Z"))
    assertEquals(LocalHistory.overlay(Vector(HistorySegment("off",10000,20000)),Vector(old)).head._2,Json.Null)
  }

  test("local streams converge only at equal complete classifier states") {
    import io.yarkivaev.temporal.{LocalStreams,Cursor}
    val pool = HistoryPool(LocalStreams.empty(30000,10000).copy(streams = Vector(Cursor(1,1000,0),Cursor(2,2000,0))),Map.empty)
    val state = HistoryState(2000,Map("power" -> (2000L,1.0)),Some(HistorySegment("off",0,2000)))
    val first = pool.completed(2,state)
    assertEquals(first.completed(1,state).cursors.streams.size,1)
    assertEquals(first.completed(1,state.copy(parameters = Map("power" -> (2000L,2.0)))).cursors.streams.size,2)
  }

  test("current operator edit overrides archived annotation including cleared tags") {
    import io.circe.Json
    def row(tags: Vector[String]) = Json.obj("kind" -> Json.fromString("phase"),"name" -> Json.fromString("off"),"start_time" -> Json.fromString("1970-01-01T00:00:00Z"),"end_time" -> Json.fromString("1970-01-01T00:00:10Z"),"tags" -> Json.arr(tags.map(Json.fromString)*))
    val old = row(Vector("A"))
    for tags <- Vector(Vector("B"),Vector.empty[String]) do
      val snapshot = Json.obj("segments" -> Json.arr(row(tags)),"annotations" -> Json.arr(old))
      val selected = LocalHistory.sources(snapshot)
      assertEquals(selected.size,1)
      assertEquals(LocalHistory.metadata(selected.head,"tags",Json.Null),Json.arr(tags.map(Json.fromString)*))
  }

  test("seed carries parameters from before bounded context without synthetic telemetry") {
    val m = machine.copy(segments = List(SegmentDef("heat",Condition.And(Condition.Above("speed",5),Condition.Above("heartbeat",0)))))
    val points = Vector(Observation("b","heartbeat",25000,1))
    assertEquals(LocalHistory.classify(m,points,Some(HistorySeed(20000,Map("speed" -> 10)))).map(_.name),Vector("heat"))
    assertEquals(LocalHistory.classify(m,points,Some(HistorySeed(-10000,Map("speed" -> 10)))).size,0)
  }

  test("seed restores carried segment when current parameters match no condition") {
    val m = machine.copy(segments = List(SegmentDef("off",Condition.Below("power",1)),SegmentDef("heat",Condition.Above("power",5))))
    val seed = HistorySeed(0,Map("power" -> 3.0),Some(HistorySegment("off",-1000,0)))
    assertEquals(LocalHistory.classify(m,Vector(Observation("x","power",1000,3)),Some(seed)),Vector(HistorySegment("off",-1000,1000)))
  }

  test("late carried value corrects through existing segment using compact real continuity") {
    val m = machine.copy(segments = List(SegmentDef("running",Condition.Above("speed",5)),SegmentDef("stopped",Condition.Below("speed",5))),window = 5)
    val seed = HistorySeed(20000,Map("speed" -> 10.0,"heartbeat" -> 1.0),Some(HistorySegment("running",0,20000)))
    val points = Vector(Observation("late","speed",25000,0),Observation("end","heartbeat",1000000,1))
    val result = LocalHistory.classify(m,points,Some(seed),Vector(HistoryRange(0,1000000)))
    assertEquals(result.last,HistorySegment("stopped",25000,1000000))
  }

  test("live tail stays pending and historical right boundary can close it") {
    val tail = HistorySegment("off",1000,5000)
    assertEquals(LocalHistory.duration(tail,5000,false),0.0)
    assertEquals(LocalHistory.duration(tail,5000,true),4.0)
    assertEquals(LocalHistory.duration(tail,10000,false),4.0)
  }
  test("late carried value crosses boundary caused by another channel until its own successor") {
    val m = machine.copy(segments = List(SegmentDef("stopped",Condition.Below("speed",5)),SegmentDef("active",Condition.Above("other",5)),SegmentDef("idle",Condition.Below("other",5))),window = 5)
    val seed = HistorySeed(20000,Map("speed" -> 10.0,"other" -> 0.0),Some(HistorySegment("idle",0,20000)))
    val points = Vector(Observation("late","speed",25000,0),Observation("other","other",40000,10),Observation("predecessor","heartbeat",995000,1),Observation("own-successor","speed",1000000,10))
    val result = LocalHistory.classify(m,points,Some(seed),Vector(HistoryRange(0,1000000)))
    assertEquals(result.map(_.name),Vector("idle","stopped","active"))
    assertEquals(result(1).end,995000L)
    // Compact history retains the actual predecessor group before the speed successor.
    assertEquals(result.last.start,1000000L)
  }

  test("late bridge restores carried parameter across an old gap without changing priority") {
    val m = machine.copy(segments = List(SegmentDef("running",Condition.Above("A",5)),SegmentDef("idle",Condition.Above("B",0))),window = 5)
    val seed = HistorySeed(20000,Map("A" -> 10.0,"B" -> 1.0),Some(HistorySegment("running",0,20000)))
    val points = Vector(Observation("lateB","B",25000,1),Observation("tailB","B",100000,1))
    val old = LocalHistory.classify(m,points,Some(seed))
    assertEquals(old.last.name,"idle")
    val bridged = LocalHistory.classify(m,points,Some(seed),Vector(HistoryRange(0,100000)))
    assertEquals(bridged,Vector(HistorySegment("running",0,100000)))
  }

  test("expanded applicable child keeps current boundary-owner label beyond archived bounds") {
    import io.circe.Json
    import java.time.Instant
    def row(name: String,start: Long,end: Long,tags: String) = Json.obj("kind" -> Json.fromString("phase"),"name" -> Json.fromString(name),
      "start_time" -> Json.fromString(Instant.ofEpochMilli(start).toString),"end_time" -> Json.fromString(Instant.ofEpochMilli(end).toString),
      "tags" -> Json.arr(Json.fromString(tags)))
    val ctx = Json.obj("segments" -> Json.arr(row("heat",0,4000,"heat"),row("off",4000,10000,"B")),
      "annotations" -> Json.arr(row("off",0,10000,"A")))
    val result = LocalHistory.overlay(Vector(HistorySegment("off",4000,12000)),LocalHistory.sources(ctx))
    assertEquals(result.head._1.start,4000L)
    assertEquals(result.last._1.end,12000L)
    assert(result.forall((_,owner) => LocalHistory.metadata(owner,"tags",Json.Null) == Json.arr(Json.fromString("B"))))
  }

  test("outward labels follow nearest boundary owners while interior holes remain unlabelled") {
    import io.circe.Json
    import java.time.Instant
    def row(start: Long,end: Long,tag: String) = Json.obj("kind" -> Json.fromString("phase"),"name" -> Json.fromString("off"),
      "start_time" -> Json.fromString(Instant.ofEpochMilli(start).toString),"end_time" -> Json.fromString(Instant.ofEpochMilli(end).toString),"tags" -> Json.arr(Json.fromString(tag)))
    val context = Json.obj("segments" -> Json.arr(row(0,4000,"A"),row(6000,10000,"B")),"annotations" -> Json.arr(row(0,10000,"OLD")))
    val rows = LocalHistory.overlay(Vector(HistorySegment("off",-2000,12000)),LocalHistory.sources(context))
    assertEquals(LocalHistory.metadata(rows.head._2,"tags",Json.Null),Json.arr(Json.fromString("A")))
    assertEquals(LocalHistory.metadata(rows.last._2,"tags",Json.Null),Json.arr(Json.fromString("B")))
    assertEquals(rows.find(_._1.start==4000).get._2,Json.Null)
  }

  private def stored(name: String,start: Long,end: Long,consumed: Boolean = false): io.circe.Json =
    import io.circe.Json
    import java.time.Instant
    Json.obj("kind" -> Json.fromString("phase"),"name" -> Json.fromString(name),
      "start_time" -> Json.fromString(Instant.ofEpochMilli(start).toString),"end_time" -> Json.fromString(Instant.ofEpochMilli(end).toString),
      "duration" -> Json.fromDoubleOrNull((end-start)/1000.0),"consumed" -> Json.fromBoolean(consumed),
      "resolved" -> Json.True,"tags" -> Json.arr(Json.fromString("operator")),"properties" -> Json.obj("note" -> Json.fromString("keep")))
  private def snapshot(until: Long, rows: io.circe.Json*): io.circe.Json =
    import io.circe.Json
    Json.obj("segments" -> Json.arr(rows*),"page" -> Json.obj("until" -> Json.fromLong(until)),"rightClosed" -> Json.True)

  test("actual commit payload omits unchanged terminal anchor rather than clipping its known tail") {
    val context = snapshot(10000,stored("off",0,10000),stored("heat",10000,20000))
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",4000,8000),HistorySegment("heat",10000,10000)),context)
    assert(!rows.exists(_.hcursor.get[String]("name").toOption.contains("heat")))
    assertEquals(rows.head.hcursor.get[Boolean]("consumed").toOption,Some(false))
  }
  test("actual commit preserves same-class known exterior with a current owner proof") {
    val owner = stored("off",0,20000)
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",4000,8000)),snapshot(8000,owner))
    assertEquals(rows.size,1)
    assertEquals(rows.head.hcursor.get[String]("end_time").toOption,owner.hcursor.get[String]("end_time").toOption)
    assertEquals(rows.head.hcursor.downField("preserveSuffix").focus,Some(owner))
    assertEquals(rows.head.hcursor.get[Double]("duration").toOption,Some(20.0))
  }
  test("partial page changes retain only the existing unobserved suffix with inherited false consumed") {
    import io.circe.Json
    val owner = stored("off",0,20000)
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",0,4000),HistorySegment("heat",5000,8000)),snapshot(8000,owner))
    val suffix = rows.find(_.hcursor.downField("preserveSuffix").focus.contains(owner)).get
    assertEquals(suffix.hcursor.get[String]("start_time").toOption,Some("1970-01-01T00:00:08.001Z"))
    assertEquals(suffix.hcursor.get[Boolean]("consumed").toOption,Some(false))
    assertEquals(LocalHistory.metadata(suffix,"tags",Json.Null),Json.arr(Json.fromString("operator")))
  }
  test("identical abutting markup stays one segment through the previous tail") {
    import io.circe.Json
    import java.time.Instant
    def piece(start: Long, end: Long) = Json.obj("kind" -> Json.fromString("phase"),"name" -> Json.fromString("off"),
      "start_time" -> Json.fromString(Instant.ofEpochMilli(start).toString),"end_time" -> Json.fromString(Instant.ofEpochMilli(end).toString),
      "tags" -> Json.arr(Json.fromString("metal_ready")))
    val rows = LocalHistory.overlay(Vector(HistorySegment("off",0,3000)),Vector(piece(0,1000),piece(1000,2000)))
    assertEquals(rows.map(_._1),Vector(HistorySegment("off",0,3000)))
  }
  test("true inside-page transitions shorten old segments without resealing identical markup") {
    val context = snapshot(20000,stored("off",0,5000),stored("off",5000,10000))
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",0,6000),HistorySegment("heat",7000,8000),HistorySegment("off",9000,10000)),context)
    assert(!rows.exists(_.hcursor.get[String]("start_time").toOption.contains("1970-01-01T00:00:05Z")))
    assert(rows.filter(_.hcursor.get[String]("name").toOption.contains("off")).forall(_.hcursor.get[Boolean]("consumed").toOption.contains(false)))
    assert(rows.forall(_.hcursor.downField("preserveSuffix").focus.isEmpty))
  }
  test("new singleton and missing classification keep their bounded semantics") {
    val context = snapshot(8000)
    assertEquals(LocalHistory.commitRows(machine,Vector.empty,context),Vector.empty)
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",8000,8000)),context)
    assertEquals(rows.size,1)
    assertEquals(rows.head.hcursor.get[Boolean]("consumed").toOption,Some(true))
  }

  test("page seed cannot reintroduce a stale exterior class over already corrected observations") {
    val seed = HistorySeed(249000,Map("power" -> 10.0),Some(HistorySegment("off",249001,249000)))
    val result = LocalHistory.classify(machine,Vector(Observation("next","power",250000,10)),Some(seed))
    assertEquals(result,Vector(HistorySegment("heat",249000,250000)))
    val old = seed.copy(segment = Some(HistorySegment("off",100000,249000)))
    assertEquals(LocalHistory.classify(machine,Vector(Observation("next","power",250000,10)),Some(old)),result)
  }

  test("a retained exterior child of an open segment stays open") {
    import io.circe.Json
    val owner = stored("off",0,20000).deepMerge(Json.obj("duration" -> Json.fromInt(0)))
    val rows = LocalHistory.commitRows(machine,Vector(HistorySegment("off",0,4000),HistorySegment("heat",5000,8000)),snapshot(8000,owner))
    val suffix = rows.find(_.hcursor.downField("preserveSuffix").focus.contains(owner)).get
    assertEquals(suffix.hcursor.get[Double]("duration").toOption,Some(0.0))
  }
