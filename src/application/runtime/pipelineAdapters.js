import { clickhouseSink, mqttSink } from '../../infrastructure/streams/index.js';
import activityTracking from '../../infrastructure/ingest/activity/activityTracking.js';
import amqpMetricsIngest from '../../infrastructure/ingest/telemetry/amqpMetricsIngest.js';
import amqpMqttRelay from '../../infrastructure/ingest/telemetry/amqpMqttRelay.js';
import modbusPublish from '../../infrastructure/ingest/mqtt/modbusPublish.js';
import mqttMetrics from '../../infrastructure/ingest/mqtt/mqttMetrics.js';
import { parseModbusDeviceSpec } from '../../infrastructure/ingest/mqtt/modbusDeviceSpec.js';
import compositeLifecycle from './compositeLifecycle.js';
import resolveSecrets from './resolveSecrets.js';

function configured(spec, context) {
    const options = { maxRecords: spec.limits?.maxRecords, maxBytes: spec.limits?.maxBytes, budget: context.budget };
    const defined = Object.fromEntries(Object.entries(options).filter(([, value]) => { return value !== undefined; }));
    return { ...resolveSecrets(spec, context.secrets),
        config: { ...resolveSecrets(spec.config, context.secrets), ...defined },
        options: { ...resolveSecrets(spec.options, context.secrets), ...defined } };
}
function adapter(factory, required, resourceKeys = () => { return []; }) {
    return {
        validate(spec) {
            required.forEach((key) => { if (!spec[key]) { throw new TypeError(`Missing pipeline ${key}`); } });
        },
        resources(spec) { return resourceKeys(spec); },
        create(spec, context) {
            let pipeline;
            let stopped = false;
            return {
                start() {
                    context.signal.throwIfAborted();
                    if (stopped) { throw new Error('Pipeline stopped'); }
                    pipeline ??= factory(configured(spec, context), context);
                    return pipeline.start();
                },
                stop() { stopped = true; return pipeline?.stop(); }
            };
        }
    };
}
function modbusResources(spec) {
    const devices = spec.config.devices?.split(',').map(parseModbusDeviceSpec) ?? [];
    const paths = devices.filter((device) => { return device.kind === 'rtu'; }).map((device) => { return `serial:${device.path}`; });
    const addresses = spec.config.addresses ?? [];
    addresses.filter((address) => { return address.startsWith('rtu://'); }).forEach((address) => {
        paths.push(`serial:${address.slice(6).split(':')[0]}`);
    });
    return [...new Set(paths)];
}
function metrics(spec, factory) {
    const sink = clickhouseSink(spec.clickhouseUrl, spec.table);
    return compositeLifecycle({ outputs: [sink], inputs: [factory(sink)] });
}
export default function pipelineAdapters() {
    return new Map([
        ['modbus', adapter((spec, context) => { return modbusPublish(spec.url, { ...spec.config, onFatal(error) {
            context.report?.({ state: 'failed', fatal: true, reason: error.code ?? error.name });
        } }); }, ['url', 'config'], modbusResources)],
        ['activity', adapter((spec) => { return activityTracking(spec.lokiUrl, spec.clickhouseUrl, spec.query, spec.config); }, ['lokiUrl', 'clickhouseUrl', 'query', 'config'])],
        ['amqp-relay', adapter((spec) => { return amqpMqttRelay(spec.url, spec.queue, mqttSink(spec.mqttUrl, spec.options), spec.options); }, ['url', 'queue', 'mqttUrl'])],
        ['amqp-metrics', adapter((spec) => { return metrics(spec, (sink) => { return amqpMetricsIngest(spec.url, spec.queue, sink, spec.options); }); }, ['url', 'queue', 'clickhouseUrl', 'table'])],
        ['mqtt-metrics', adapter((spec) => { return metrics(spec, (sink) => { return mqttMetrics(spec.url, sink, spec.topic, spec.config); }); }, ['url', 'topic', 'clickhouseUrl', 'table', 'config'])]
    ]);
}
