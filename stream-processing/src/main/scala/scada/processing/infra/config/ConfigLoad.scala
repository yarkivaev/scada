package scada.processing.infra.config

import io.yarkivaev.segmentation.{Condition, CycleAnchors, CyclePhase, CyclePhases, SegmentDef, TagDef}
import cats.effect.IO
import com.typesafe.config.{Config, ConfigFactory, ConfigValueType}
import scada.processing.core.*
import scala.jdk.CollectionConverters.*

/**
 * Loads and validates [[AppConfig]] from HOCON files. Fails fast on
 * missing required paths and unknown condition shapes.
 *
 * {{{
 * ConfigLoad().load("config/application.conf")
 * }}}
 */
final class ConfigLoad(
    runtimeToken: Option[String] = sys.env.get("STATE_HTTP_TOKEN"),
    env: collection.Map[String, String] = sys.env,
    profile: ConfigProfile = ConfigProfile.default
):
  def load(path: String): IO[AppConfig] = IO:
    parse(ConfigFactory.parseFile(java.io.File(path)).resolve())

  private def parse(raw: Config): AppConfig =
    val historyOn = (raw.hasPath("history.enabled") && raw.getBoolean("history.enabled")) || env.get("SUPERVISOR_LOCAL_HISTORY").contains("true")
    val epoch = writerEpoch(raw)
    val lease = leaseUrl(raw)
    val role = writerRole(raw)
    val held = env.contains("SUPERVISOR_LEASE_URL") || !env.contains("SUPERVISOR_LEASE_URL_HELD")
    require(!historyOn || epoch.exists(_ >= 1L), "Local history requires a positive writer epoch")
    require(!historyOn || lease.exists(_.nonEmpty), "Local history requires a lease url")
    val loaded = AppConfig(
      connectivity(raw),
      classifyGroup(machines(raw)),
      routing(raw.getConfig("routing")),
      seeding(raw),
      health(raw),
      cyclePhases(raw),
      historyOn,
      epoch,
      lease,
      role,
      held
    )
    profile.validate(raw, loaded)
    loaded

  private def writerEpoch(raw: Config): Option[Long] =
    val configured = if raw.hasPath("history.writer-epoch") then Some(raw.getLong("history.writer-epoch")) else None
    val epoch = configured.orElse(env.get("SUPERVISOR_WRITER_EPOCH").map(_.toLong))
    epoch.foreach(value => require(value >= 1L, s"Writer epoch must be positive, message $value"))
    epoch

  private def writerRole(raw: Config): Option[String] =
    val configured = if raw.hasPath("history.role") then Some(raw.getString("history.role")) else None
    val role = configured.orElse(env.get("SUPERVISOR_WRITER_ROLE"))
    role.foreach(value => require(value == "leader" || value == "standby", s"Writer role must be leader or standby, role $value"))
    role

  private def leaseUrl(raw: Config): Option[String] =
    val configured = if raw.hasPath("history.lease-url") then Some(raw.getString("history.lease-url")) else None
    val url = configured.orElse(env.get("SUPERVISOR_LEASE_URL")).orElse(env.get("SUPERVISOR_LEASE_URL_HELD"))
    url.foreach(value => require(value.startsWith("jdbc:postgresql:") || value.startsWith("postgresql://") || value.startsWith("postgres://"), "Lease url must be a postgres jdbc url"))
    url

  private def connectivity(raw: Config): ConnectivityConfig =
    ConnectivityConfig(mqtt(raw), rabbitmq(raw), checkpointApi(raw), clickhouseReadings(raw))

  private def mqtt(raw: Config): MqttConfig =
    MqttConfig(raw.getString("mqtt.host"), raw.getInt("mqtt.port"), raw.getString("mqtt.client-id"),
      Option.when(raw.hasPath("mqtt.username"))(raw.getString("mqtt.username")),
      Option.when(raw.hasPath("mqtt.password"))(raw.getString("mqtt.password")))

  private def rabbitmq(raw: Config): RabbitMqConfig =
    val segmentsDest =
      if raw.hasPath("rabbitmq.destinations.segments") then Some(raw.getString("rabbitmq.destinations.segments"))
      else None
    RabbitMqConfig(
      StompAddress(raw.getString("rabbitmq.address.host"), raw.getInt("rabbitmq.address.port")),
      raw.getString("rabbitmq.vhost"),
      StompCredentials(raw.getString("rabbitmq.credentials.login"), raw.getString("rabbitmq.credentials.passcode")),
      StompDestinations(raw.getString("rabbitmq.destinations.user-decisions"), segmentsDest)
    )

  private def checkpointApi(raw: Config): Option[CheckpointApiConfig] =
    if raw.hasPath("checkpoint-api.base-url") then
      val token =
        if raw.hasPath("checkpoint-api.token") then Some(raw.getString("checkpoint-api.token"))
        else runtimeToken
      val timeoutSeconds =
        if raw.hasPath("checkpoint-api.timeout-seconds") then raw.getInt("checkpoint-api.timeout-seconds")
        else CheckpointApiConfig.defaultTimeoutSeconds
      Some(CheckpointApiConfig(raw.getString("checkpoint-api.base-url"), token, timeoutSeconds))
    else None

  private def seeding(raw: Config): SeedingConfig =
    val capacity =
      if raw.hasPath("seeding.capacity") then raw.getInt("seeding.capacity")
      else SeedingConfig.default.capacity
    val useClickhouseReadings =
      if raw.hasPath("seeding.use-clickhouse-readings") then raw.getBoolean("seeding.use-clickhouse-readings")
      else SeedingConfig.default.useClickhouseReadings
    SeedingConfig(capacity, useClickhouseReadings)

  private def clickhouseReadings(raw: Config): Option[ClickhouseReadingsConfig] =
    if raw.hasPath("clickhouse-readings.base-url") then
      val table =
        if raw.hasPath("clickhouse-readings.table") then raw.getString("clickhouse-readings.table")
        else ClickhouseReadingsConfig.defaultTable
      val batchSize =
        if raw.hasPath("clickhouse-readings.batch-size") then raw.getInt("clickhouse-readings.batch-size")
        else ClickhouseReadingsConfig.defaultBatchSize
      val timeoutSeconds =
        if raw.hasPath("clickhouse-readings.timeout-seconds") then raw.getInt("clickhouse-readings.timeout-seconds")
        else ClickhouseReadingsConfig.defaultTimeoutSeconds
      Some(ClickhouseReadingsConfig(
        raw.getString("clickhouse-readings.base-url"),
        raw.getString("clickhouse-readings.database"),
        table,
        batchSize,
        timeoutSeconds
      ))
    else None

  private def health(raw: Config): HealthConfig =
    val port =
      if raw.hasPath("health.port") then raw.getInt("health.port") else HealthConfig.default.port
    val window =
      if raw.hasPath("health.ready-window-seconds") then raw.getInt("health.ready-window-seconds")
      else HealthConfig.default.readyWindowSeconds
    HealthConfig(port, window)

  private def classifyGroup(loaded: List[MachineConfig]): List[MachineConfig] =
    val want = env.get("CLASSIFY_GROUP").toList.flatMap(_.split(',')).map(_.trim).filter(_.nonEmpty).toSet
    loaded.filter(machine => want(machine.id.raw) || profile.inGroup(machine, want))

  private def machines(raw: Config): List[MachineConfig] =
    raw.getConfigList("machines").asScala.toList.map(machine)

  private def machine(raw: Config): MachineConfig =
    MachineConfig(
      MachineId(raw.getString("id")),
      raw.getConfigList("segments").asScala.toList.map(segmentDef),
      if raw.hasPath("tags") then raw.getConfigList("tags").asScala.toList.map(tagDef) else Nil,
      raw.getInt("window"),
      profile.mode(raw)
    )

  private def segmentDef(raw: Config): SegmentDef =
    SegmentDef(raw.getString("name"), condition(raw.getConfig("condition")))

  private def tagDef(raw: Config): TagDef =
    TagDef(raw.getString("name"), condition(raw.getConfig("condition")))

  private def condition(raw: Config): Condition =
    if raw.hasPath("above") then
      Condition.Above(raw.getConfig("above").getString("param"), raw.getConfig("above").getDouble("threshold"))
    else if raw.hasPath("below") then
      Condition.Below(raw.getConfig("below").getString("param"), raw.getConfig("below").getDouble("threshold"))
    else if raw.hasPath("equal") then
      Condition.Equal(raw.getConfig("equal").getString("param"), raw.getConfig("equal").getDouble("value"))
    else if raw.hasPath("when") then Condition.When(raw.getString("when"))
    else if raw.hasPath("and") then
      raw.getConfigList("and").asScala.toList.map(condition).reduceLeft(Condition.And(_, _))
    else if raw.hasPath("or") then
      raw.getConfigList("or").asScala.toList.map(condition).reduceLeft(Condition.Or(_, _))
    else throw RuntimeException(s"unknown condition shape: ${raw.root().keySet()}")

  private def routing(raw: Config): RoutingConfig =
    val aliasesRaw = raw.getConfig("aliases")
    RoutingConfig(aliasesRaw.root().keySet().asScala.toList.map: id =>
      MachineId(id) -> aliasesRaw.getConfigList(id).asScala.toList.map: a =>
        AliasMapping(a.getString("topic"), a.getString("metric"))
    .toMap)

  private def cyclePhases(raw: Config): CyclePhases =
    if !raw.hasPath("cycle-phases") then CyclePhases.empty
    else
      val cfg = raw.getConfig("cycle-phases")
      val names = cfg.root().keySet().asScala.toList.filterNot(key => key == "flat" || key == "anchors")
      val loaded = names.map: name =>
        val block = cfg.getConfig(name)
        val allow = block.getStringList("allow").asScala.toList
        val enter = if block.hasPath("enter") then Some(block.getString("enter")) else None
        CyclePhase(allow, enter)
      if !loaded.exists(_.enter.isEmpty) then
        throw RuntimeException("cycle-phases has no idle phase without enter")
      CyclePhases(
        cfg.getStringList("flat").asScala.toList,
        CycleAnchors(
          cfg.getString("anchors.start"),
          stopIds(cfg.getConfig("anchors"))
        ),
        loaded
      )

  private def stopIds(anchors: Config): List[String] =
    if anchors.hasPath("stops") && anchors.getValue("stops").valueType == ConfigValueType.LIST then
      anchors.getStringList("stops").asScala.toList
    else if anchors.hasPath("stop") && anchors.getValue("stop").valueType == ConfigValueType.LIST then
      anchors.getStringList("stop").asScala.toList
    else List(anchors.getString("stop"))
