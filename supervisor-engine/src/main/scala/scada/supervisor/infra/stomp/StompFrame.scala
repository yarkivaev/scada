package scada.supervisor.infra.stomp

/**
 * Minimal STOMP 1.2 frame: command, headers, body. Round-trips via
 * [[encode]] / [[StompFrame.decode]].
 *
 * {{{
 * StompFrame("SEND", Map("destination" -> "/exchange/foo"), "body").encode
 * }}}
 */
final case class StompFrame(command: String, headers: Map[String, String], body: String):
  def encode: Array[Byte] =
    val sb = StringBuilder()
    sb.append(command).append('\n')
    headers.foreach((k, v) => sb.append(k).append(':').append(v).append('\n'))
    sb.append('\n').append(body).append('\u0000')
    sb.toString.getBytes("UTF-8")

object StompFrame:
  def decode(data: String): Option[StompFrame] =
    val nullIdx = data.indexOf('\u0000')
    val clean = if nullIdx >= 0 then data.substring(0, nullIdx) else data
    val parts = clean.split("\n\n", 2)
    if parts.isEmpty then None
    else
      parts(0).split("\n").toList match
        case command :: headerLines =>
          val headers = headerLines.flatMap: line =>
            val idx = line.indexOf(':')
            if idx > 0 then Some(line.substring(0, idx) -> line.substring(idx + 1))
            else None
          Some(StompFrame(command, headers.toMap, if parts.length > 1 then parts(1) else ""))
        case _ => None

  def connect(host: String, login: String, passcode: String): StompFrame =
    StompFrame(
      "CONNECT",
      Map(
        "accept-version" -> "1.2",
        "host"           -> host,
        "login"          -> login,
        "passcode"       -> passcode,
        "heart-beat"     -> "0,0"
      ),
      ""
    )

  def send(destination: String, routingKey: String, body: String): StompFrame =
    StompFrame(
      "SEND",
      Map(
        "destination"  -> destination,
        "content-type" -> "application/json",
        "routing-key"  -> routingKey,
        "persistent"   -> "true"
      ),
      body
    )

  def subscribe(destination: String, id: String): StompFrame =
    StompFrame(
      "SUBSCRIBE",
      Map("destination" -> destination, "id" -> id, "ack" -> "auto"),
      ""
    )

  def disconnect: StompFrame = StompFrame("DISCONNECT", Map.empty, "")
