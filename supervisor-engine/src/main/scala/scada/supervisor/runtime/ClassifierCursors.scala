package scada.supervisor.runtime

import io.circe.Json
import io.circe.parser.parse
import io.yarkivaev.temporal.{Cursor, LocalStreams}
import java.sql.Connection

/**
 * Persists LocalStreams cursor metadata for one machine. Telemetry
 * points stay out of Postgres; only id, position and touchedAt remain.
 *
 * {{{
 * ClassifierCursors.save(connection, "machine-2", pool)
 * ClassifierCursors.load(connection, "machine-2", 30000, 10000)
 * }}}
 */
object ClassifierCursors:
  val ddl: String = "CREATE TABLE IF NOT EXISTS classifier_cursors (machine text PRIMARY KEY, snapshot text NOT NULL)"
  val writeSql: String = "INSERT INTO classifier_cursors (machine, snapshot) VALUES (?, ?) ON CONFLICT (machine) DO UPDATE SET snapshot = EXCLUDED.snapshot"
  val readSql: String = "SELECT snapshot FROM classifier_cursors WHERE machine = ?"
  def save(connection: Connection, machine: String, pool: HistoryPool): Unit =
    val created = connection.prepareStatement(ddl)
    try created.execute()
    finally created.close()
    val statement = connection.prepareStatement(writeSql)
    try
      statement.setString(1, machine)
      statement.setString(2, snapshot(pool).noSpaces)
      val _ = statement.executeUpdate()
    finally statement.close()
  def load(connection: Connection, machine: String, maxGap: Long, idleTimeout: Long): HistoryPool =
    val created = connection.prepareStatement(ddl)
    try created.execute()
    finally created.close()
    val statement = connection.prepareStatement(readSql)
    try
      statement.setString(1, machine)
      val rows = statement.executeQuery()
      val pool = if rows.next() then restore(rows.getString(1), maxGap, idleTimeout) else HistoryPool(LocalStreams.empty(maxGap, idleTimeout), Map.empty)
      rows.close()
      pool
    finally statement.close()
  private def snapshot(pool: HistoryPool): Json =
    Json.obj(
      "nextId" -> Json.fromLong(pool.cursors.nextId),
      "streams" -> Json.arr(pool.cursors.streams.map: cursor =>
        Json.obj("id" -> Json.fromLong(cursor.id), "position" -> Json.fromLong(cursor.position), "touchedAt" -> Json.fromLong(cursor.touchedAt))
      *)
    )
  private def restore(body: String, maxGap: Long, idleTimeout: Long): HistoryPool =
    val json = parse(body).getOrElse(Json.obj())
    val nextId = json.hcursor.get[Long]("nextId").getOrElse(1L)
    val streams = json.hcursor.get[Vector[Json]]("streams").getOrElse(Vector.empty).flatMap: row =>
      for
        id <- row.hcursor.get[Long]("id").toOption
        position <- row.hcursor.get[Long]("position").toOption
      yield Cursor(id, position, System.currentTimeMillis())
    HistoryPool(LocalStreams(maxGap, idleTimeout, nextId, streams, Vector.empty), Map.empty)
