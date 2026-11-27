package scada.supervisor.runtime

import cats.effect.{IO, Resource}
import java.sql.{Connection, DriverManager}

/**
 * One Postgres session owns classification of one machine.
 * The advisory lock dies with the session, so a dead leader is fenced out.
 *
 * {{{
 * WriterLease.open("jdbc:postgresql://127.0.0.1:1/scada", "machine-1")
 * }}}
 */
object WriterLease:
  val tailSql: String = "SELECT COALESCE((EXTRACT(EPOCH FROM max(end_time)) * 1000)::bigint, 0) FROM segments WHERE machine = ? AND kind = 'phase'"
  val listSql: String = "SELECT kind,name,start_time,end_time,duration,options,tags,properties,resolved,consumed FROM segments WHERE machine = ? AND kind = 'phase' ORDER BY start_time"
  private[runtime] def row(result: java.sql.ResultSet): io.circe.Json =
    import io.circe.Json
    def field(name: String): Json =
      Option(result.getString(name)).map(text => io.circe.parser.parse(text).getOrElse(Json.fromString(text))).getOrElse(Json.Null)
    val start = result.getTimestamp("start_time").toInstant
    val end = result.getTimestamp("end_time").toInstant
    Json.obj(
      "kind" -> Json.fromString(Option(result.getString("kind")).getOrElse("phase")),
      "name" -> Json.fromString(Option(result.getString("name")).getOrElse("")),
      "start_time" -> Json.fromString(start.toString),
      "end_time" -> Json.fromString(end.toString),
      "duration" -> Json.fromDoubleOrNull(result.getDouble("duration")),
      "options" -> field("options"),
      "tags" -> field("tags"),
      "properties" -> field("properties"),
      "resolved" -> Json.fromBoolean(result.getBoolean("resolved")),
      "consumed" -> Json.fromBoolean(result.getBoolean("consumed"))
    )
  /** Holds the session when this process is the only classifier. */
  def open(url: String, machine: String): Resource[IO, LeaseHold] =
    if machine.isEmpty then Resource.raiseError[IO, LeaseHold, Throwable](IllegalArgumentException("Lease holder required"))
    else Resource.make(IO.blocking(claim(url, machine)))(hold => IO.blocking(hold.close()))

  /** Accepts the JDBC form and the postgres URL the history secret already stores. User info stays out of the JDBC string. */
  def jdbc(url: String): String =
    val normalized =
      if url.startsWith("jdbc:postgresql:") then url
      else if url.startsWith("postgresql://") then s"jdbc:$url"
      else if url.startsWith("postgres://") then s"jdbc:postgresql://${url.drop("postgres://".length)}"
      else throw IllegalArgumentException("Lease url must be a postgres jdbc url")
    val marker = "://"
    val start = normalized.indexOf(marker)
    val rest = normalized.drop(start + marker.length)
    val at = rest.lastIndexOf('@')
    if at < 0 then normalized else normalized.take(start + marker.length) + rest.drop(at + 1)

  /** User and password for a URL that stores them before the host. */
  private[runtime] def credentials(url: String): java.util.Properties =
    val props = new java.util.Properties()
    val marker = "://"
    val start = url.indexOf(marker)
    if start < 0 then props
    else
      val rest = url.drop(start + marker.length)
      val at = rest.lastIndexOf('@')
      if at < 0 then props
      else
        val info = rest.take(at)
        val colon = info.indexOf(':')
        val user = if colon < 0 then info else info.take(colon)
        val password = if colon < 0 then "" else info.drop(colon + 1)
        props.setProperty("user", java.net.URLDecoder.decode(user, "UTF-8"))
        props.setProperty("password", java.net.URLDecoder.decode(password, "UTF-8"))
        props

  /**
   * Epoch to publish. None means this process must not publish.
   * Some(None) is the legacy publisher with no epoch field.
   *
   * {{{
   * WriterLease.publication(Some("postgres://127.0.0.1:1/scada"), Some(LeaseGrant(true, 7)), Some(1L))
   * }}}
   */
  def publication(lease: Option[String], grant: Option[LeaseGrant], configured: Option[Long]): Option[Option[Long]] =
    if lease.exists(_.nonEmpty) then grant.flatMap(_.epoch).map(Some(_)) else Some(configured)

  /**
   * Generation for the session that took the lock.
   * The stored counter is the last generation issued for this machine, or zero when none exists.
   * The same counter keeps the same generation. A missed lock returns nothing to publish.
   * The advisory-lock session reads that counter and calls this step.
   *
   * {{{
   * WriterLease.claim(true, 4L)
   * }}}
   */
  private[runtime] def claim(held: Boolean, stored: Long): Option[LeaseGrant] =
    if !held then None
    else
      val grant = LeaseGrant(true, stored + 1)
      val _ = grant.epoch
      Some(grant)

  private def claim(url: String, machine: String): LeaseHold =
    try session(url, machine)
    catch case error: Exception => throw IllegalStateException(s"Classifier lease failed for $machine: ${error.getClass.getSimpleName}")

  /** Opens the driver and drops the session when the hold cannot be built. */
  private def session(url: String, machine: String): LeaseHold =
    val _ = Class.forName("org.postgresql.Driver")
    val connection = DriverManager.getConnection(jdbc(url), credentials(url))
    try hold(connection, machine)
    catch
      case error: Exception =>
        connection.close()
        throw error

  /** Takes the advisory lock and stamps the stored generation when this session holds it. */
  private def hold(connection: Connection, machine: String): LeaseHold =
    val held = locked(connection, machine)
    LeaseHold(held, connection, advance(connection, machine, held))

  /** True when this session took the classifier lock. The lock stays with the connection. */
  private def locked(connection: Connection, machine: String): Boolean =
    val statement = connection.prepareStatement("SELECT pg_try_advisory_lock(hashtext('scada-classify'), hashtext(?))")
    try
      statement.setString(1, machine)
      val rows = statement.executeQuery()
      val held = rows.next() && rows.getBoolean(1)
      rows.close()
      held
    finally statement.close()

  /** Reads the stored counter on this session and returns the generation the holder may stamp. */
  private def advance(connection: Connection, machine: String, held: Boolean): Option[Long] =
    val grant = claim(held, if held then counter(connection, machine) else 0L)
    grant.foreach(item => remember(connection, machine, item.generation))
    grant.flatMap(_.epoch)

  /** Last generation issued for this machine, or zero when the lock has never been held. */
  private def counter(connection: Connection, machine: String): Long =
    val created = connection.prepareStatement("CREATE TABLE IF NOT EXISTS classifier_generation (machine text PRIMARY KEY, generation bigint NOT NULL)")
    try
      val _ = created.execute()
    finally created.close()
    val query = connection.prepareStatement("SELECT generation FROM classifier_generation WHERE machine = ?")
    try
      query.setString(1, machine)
      val rows = query.executeQuery()
      val generation = if rows.next() then rows.getLong(1) else 0L
      rows.close()
      generation
    finally query.close()

  /** Stores the generation this session just issued so the next hold is greater. */
  private def remember(connection: Connection, machine: String, generation: Long): Unit =
    val query = connection.prepareStatement("INSERT INTO classifier_generation (machine, generation) VALUES (?, ?) ON CONFLICT (machine) DO UPDATE SET generation = EXCLUDED.generation")
    try
      query.setString(1, machine)
      query.setLong(2, generation)
      val _ = query.executeUpdate()
    finally query.close()

/**
 * Generation a process may stamp while it holds the classifier lease.
 * A process that does not hold the lease has nothing to publish.
 *
 * {{{
 * LeaseGrant(true, 7).epoch
 * }}}
 */
final case class LeaseGrant(held: Boolean, generation: Long):
  /** Epoch field for a holder. Empty when the lease is not held. */
  def epoch: Option[Long] =
    if !held then None
    else
      require(WriterEpoch.accept(generation, generation), s"Writer epoch must be positive, message $generation")
      Some(generation)

/**
 * The open session. Ready reads watermarks on that same session.
 * A missing phase comes back as millisecond 0 and does not count as caught up.
 * The session that takes the lock stores the next generation here.
 * A missed lock leaves the generation empty.
 *
 * {{{
 * hold.ready("machine-1", false)
 * }}}
 */
final case class LeaseHold(held: Boolean, connection: Connection, generation: Option[Long] = None):
  /** Live AMQP watermark plus stored segment end when this process may classify. None waits. */
  def ready(machine: String, leader: Boolean, observationMs: Long = 0L): IO[Option[(Long, Option[Long])]] =
    IO.blocking:
      val segment = scalar(WriterLease.tailSql, machine)
      if WriterGate.ready(observationMs, segment, leader) then Some((observationMs, Option.when(segment > 0)(segment))) else None

  /** Stored phase rows and their latest end. Supervisor postgres is segments only. */
  def seed(machine: String): IO[(Option[Long], Vector[io.circe.Json])] =
    IO.blocking:
      val segment = scalar(WriterLease.tailSql, machine)
      (Option.when(segment > 0)(segment), phases(machine))

  /** Closes the session and drops the advisory lock. */
  def close(): Unit = connection.close()

  private def scalar(sql: String, machine: String): Long =
    val statement = connection.prepareStatement(sql)
    try
      statement.setString(1, machine)
      val rows = statement.executeQuery()
      if rows.next() then rows.getLong(1) else 0L
    finally statement.close()

  private def phases(machine: String): Vector[io.circe.Json] =
    val statement = connection.prepareStatement(WriterLease.listSql)
    try
      statement.setString(1, machine)
      val result = statement.executeQuery()
      val buffer = Vector.newBuilder[io.circe.Json]
      while result.next() do buffer += WriterLease.row(result)
      buffer.result()
    finally statement.close()
