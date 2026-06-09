/**
 * scada v2 — generic industrial monitoring domain and HTTP API.
 */

export { default as plant } from './src/domain/plant/plant.js';
export { default as shop } from './src/domain/plant/shop.js';
export { default as machine } from './src/domain/plant/machine.js';
export { default as timeline } from './src/domain/timeline/timeline.js';
export { alert, acknowledgedAlert } from './src/domain/alerting/alert.js';
export { default as alerts } from './src/domain/alerting/alerts.js';
export { default as initialized } from './src/domain/shared/initialized.js';
export { default as pubsub } from './src/domain/shared/pubsub.js';

export { default as plantApi } from './src/application/plantApi.js';
export { default as machineInPlant } from './src/application/machineInPlant.js';
export { default as shopWithTimeline } from './src/application/shopWithTimeline.js';
export { default as metricsPlant } from './src/application/metricsPlant.js';
export { default as plantServer } from './src/application/plantServer.js';
export { default as siteServer } from './src/application/siteServer.js';

export { default as pgTimeline } from './src/infrastructure/persistence/pg/timeline.js';
export { default as pgAlerts } from './src/infrastructure/persistence/pg/alerts.js';
export { default as clickhouseConnection } from './src/infrastructure/persistence/clickhouse/connection.js';
export { default as clickhouseSensor } from './src/infrastructure/persistence/clickhouse/sensor.js';
export { default as postgresPool } from './src/infrastructure/persistence/postgresPool.js';
export { metricsSinkFromPool as pgMetricsSink } from './src/infrastructure/persistence/pg/metrics.js';
export { pgMetricsSensor } from './src/infrastructure/persistence/metricsSensor.js';
export { default as stompTimeline } from './src/infrastructure/messaging/stomp/timeline.js';
export { default as stompTimelineSegments } from './src/infrastructure/messaging/stomp/stompTimelineSegments.js';
export { default as stateDataFromPool } from './src/infrastructure/persistence/stateDataFromPool.js';
export { default as stateDataFromMemory } from './src/infrastructure/persistence/stateDataFromMemory.js';
export { default as stateDataFake } from './src/infrastructure/persistence/stateDataFromMemory.js';
export { default as supervisorSink, readDeploymentConfig } from './src/application/supervisorSink.js';
export { default as runRetention } from './src/infrastructure/ingest/db/runRetention.js';
export { createEdgeApi, default as edgeApi } from './src/infrastructure/http/edge/edgeApi.js';
export { default as startTestEdgeApi } from './src/infrastructure/http/edge/startTestEdgeApi.js';
export { default as stateHttpClient } from './src/infrastructure/http/edge/stateHttpClient.js';
export { default as metricsSensor } from './src/infrastructure/http/edge/metricsSensor.js';
export { default as userDecisions } from './src/infrastructure/messaging/stomp/userDecisions.js';
export { default as stompAlerts } from './src/infrastructure/messaging/stomp/alerts/stompAlerts.js';
export { default as stompAlertsInit } from './src/infrastructure/messaging/stomp/alerts/stompAlertsInit.js';
export { default as mqttMetrics } from './src/infrastructure/ingest/mqtt/mqttMetrics.js';
export { default as modbusMqtt } from './src/infrastructure/ingest/mqtt/modbusMqtt.js';
export { default as activityTracking } from './src/infrastructure/ingest/activity/activityTracking.js';
export { default as amqpMetricsIngest } from './src/infrastructure/ingest/telemetry/amqpMetricsIngest.js';
export { default as amqpMqttRelay } from './src/infrastructure/ingest/telemetry/amqpMqttRelay.js';
