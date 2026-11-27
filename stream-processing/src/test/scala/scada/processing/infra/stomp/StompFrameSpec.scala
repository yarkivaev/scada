package scada.processing.infra.stomp

import munit.FunSuite

/**
 * Round-trips [[StompFrame]] encode/decode on every factory plus
 * adversarial payloads. Guards the wire-format against codec drift
 * without requiring a broker.
 */
final class StompFrameSpec extends FunSuite:

  private def roundTrip(frame: StompFrame): StompFrame =
    val encoded = String(frame.encode, "UTF-8")
    StompFrame.decode(encoded).getOrElse(fail(s"decode returned None for $encoded"))

  test("CONNECT round-trips command and headers"):
    val original = StompFrame.connect("/", "u", "p")
    val decoded  = roundTrip(original)
    assertEquals(decoded.command, "CONNECT")
    assertEquals(decoded.headers("accept-version"), "1.2")
    assertEquals(decoded.headers("host"), "/")
    assertEquals(decoded.headers("login"), "u")
    assertEquals(decoded.headers("passcode"), "p")

  test("SEND round-trips command headers and body"):
    val original = StompFrame.send("/exchange/foo", "rk", """{"k":1}""")
    val decoded  = roundTrip(original)
    assertEquals(decoded.command, "SEND")
    assertEquals(decoded.headers("destination"), "/exchange/foo")
    assertEquals(decoded.headers("content-type"), "application/json")
    assertEquals(decoded.headers("routing-key"), "rk")
    assertEquals(decoded.headers("persistent"), "true")
    assertEquals(decoded.body, """{"k":1}""")

  test("SUBSCRIBE round-trips destination and id"):
    val decoded = roundTrip(StompFrame.subscribe("/exchange/decisions", "42"))
    assertEquals(decoded.command, "SUBSCRIBE")
    assertEquals(decoded.headers("destination"), "/exchange/decisions")
    assertEquals(decoded.headers("id"), "42")
    assertEquals(decoded.headers("ack"), "auto")

  test("DISCONNECT round-trips with no headers and empty body"):
    val decoded = roundTrip(StompFrame.disconnect)
    assertEquals(decoded.command, "DISCONNECT")
    assertEquals(decoded.headers, Map.empty[String, String])
    assertEquals(decoded.body, "")

  test("encode appends null terminator"):
    val bytes = StompFrame.disconnect.encode
    assertEquals(bytes.last, 0.toByte)

  test("decode strips null terminator when present"):
    val decoded = StompFrame.decode("SEND\ndestination:/foo\n\nbody\u0000").get
    assertEquals(decoded.body, "body")

  test("decode returns None on empty string"):
    assertEquals(StompFrame.decode(""), Some(StompFrame("", Map.empty, "")))

  test("decode preserves a body containing double newline"):
    val encoded = String(StompFrame.send("/d", "", "line1\n\nline2").encode, "UTF-8")
    val decoded = StompFrame.decode(encoded).get
    assertEquals(decoded.body, "line1\n\nline2")

  test("decode keeps empty body when no body separator"):
    val decoded = StompFrame.decode("DISCONNECT\n").get
    assertEquals(decoded.body, "")

  test("decode drops header lines without colon"):
    val decoded = StompFrame.decode("SEND\ngarbage\ndest:/foo\n\nbody\u0000").get
    assertEquals(decoded.headers.get("garbage"), None)
    assertEquals(decoded.headers("dest"), "/foo")

  test("decode preserves value containing colons"):
    val decoded = StompFrame.decode("MESSAGE\ndestination:/exchange/a:b\n\nbody\u0000").get
    assertEquals(decoded.headers("destination"), "/exchange/a:b")

  test("roundtrip of empty body preserves empty"):
    val decoded = roundTrip(StompFrame("HEARTBEAT", Map("x" -> "y"), ""))
    assertEquals(decoded.body, "")
