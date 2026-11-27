package scada.processing.infra.config

import scada.processing.core.{CyclePhases, MachineConfig, MachineId}

/**
 * Alias routing entry: which MQTT topic carries which metric.
 *
 * {{{
 * AliasMapping("machine-1/power", "power")
 * }}}
 */
final case class AliasMapping(topic: String, metric: String)

/**
 * Alias routing table (machine → its topic/metric list).
 *
 * {{{
 * RoutingConfig(Map(MachineId("machine-1") -> List(AliasMapping(...))))
 * }}}
 */
final case class RoutingConfig(aliases: Map[MachineId, List[AliasMapping]])

/**
 * MQTT broker connection settings.
 *
 * {{{
 * MqttConfig("localhost", 1883, "sup")
 * }}}
 */
final case class MqttConfig(host: String, port: Int, clientId: String, username: Option[String] = None, password: Option[String] = None):
  require(username.isDefined == password.isDefined, "MQTT username and password must be supplied together")
  require(username.forall(_.nonEmpty) && password.forall(_.nonEmpty), "MQTT credentials must be nonempty")

/** STOMP broker endpoint. */
final case class StompAddress(host: String, port: Int)

/** STOMP login credentials. */
final case class StompCredentials(login: String, passcode: String)

/**
 * RabbitMQ STOMP destinations. `segments` is optional — when absent
 * outbound segment publishing is disabled.
 *
 * {{{
 * StompDestinations("user_decisions", Some("segments"))
 * }}}
 */
final case class StompDestinations(userDecisions: String, segments: Option[String])

/**
 * RabbitMQ STOMP connection and routing settings.
 *
 * {{{
 * RabbitMqConfig(StompAddress("rmq", 61613), "/", StompCredentials(...), StompDestinations(...))
 * }}}
 */
final case class RabbitMqConfig(
    address: StompAddress,
    vhost: String,
    credentials: StompCredentials,
    destinations: StompDestinations
)

/** Internal checkpoint API exposed by supervisor-sink. */
final case class CheckpointApiConfig(baseUrl: String, token: Option[String], timeoutSeconds: Int)

object CheckpointApiConfig:
  val defaultTimeoutSeconds: Int = 10

final case class ClickhouseReadingsConfig(
    baseUrl: String,
    database: String,
    table: String,
    batchSize: Int,
    timeoutSeconds: Int
)

object ClickhouseReadingsConfig:
  val defaultTable: String = "metrics"
  val defaultBatchSize: Int = 5000
  val defaultTimeoutSeconds: Int = 30

/**
 * IO boundaries of the supervisor. `checkpointApi` is optional; without it
 * startup replay and pending-island restore are disabled.
 */
final case class ConnectivityConfig(
    mqtt: MqttConfig,
    rabbitmq: RabbitMqConfig,
    checkpointApi: Option[CheckpointApiConfig],
    clickhouseReadings: Option[ClickhouseReadingsConfig]
)

/**
 * Bounded-queue capacity for the startup replay-to-live seam.
 * Larger values absorb more live readings while history drains at
 * the cost of heap; smaller values back-pressure Paho sooner.
 */
final case class SeedingConfig(capacity: Int, useClickhouseReadings: Boolean)

object SeedingConfig:
  val default: SeedingConfig = SeedingConfig(10000, false)

/**
 * HTTP health/readiness endpoint binding. `/health` and `/ready` are
 * process liveness. Source silence is a tape cover, not a 503.
 */
final case class HealthConfig(port: Int, readyWindowSeconds: Int)

object HealthConfig:
  val default: HealthConfig = HealthConfig(8080, 60)

/**
 * Top-level application configuration loaded from HOCON.
 *
 * {{{
 * AppConfig(connectivity, machines, routing, seeding, health, cyclePhases)
 * }}}
 */
final case class AppConfig(
    connectivity: ConnectivityConfig,
    machines: List[MachineConfig],
    routing: RoutingConfig,
    seeding: SeedingConfig,
    health: HealthConfig,
    cyclePhases: CyclePhases,
    localHistory: Boolean = false,
    writerEpoch: Option[Long] = None,
    leaseUrl: Option[String] = None,
    writerRole: Option[String] = None,
    leaseHeld: Boolean = true
)
