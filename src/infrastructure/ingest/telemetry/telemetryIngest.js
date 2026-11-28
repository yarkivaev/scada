import amqpMetricsIngest from './amqpMetricsIngest.js';

function batchConfig(options) {
    const config = { size: 256, prefetch: 512, maxWaitMs: 1000, writeTimeoutMs: 45000, ...options };
    for (const key of ['size', 'prefetch', 'maxWaitMs', 'writeTimeoutMs']) {
        if (!Number.isSafeInteger(config[key]) || config[key] <= 0) { throw new Error(`Invalid telemetry ${key}`); }
    }
    if (config.size > config.prefetch) { throw new Error('Telemetry batch exceeds the broker acknowledgement window'); }
    return config;
}

function metricBatches(metrics, state, clock, failure, halt) {
    return {
        requireTimestamp: metrics.requireTimestamp === true,
        async write(records, context) {
            try {
                await metrics.insertRows(records, context);
                state.records += records.length;
                state.batches += 1;
                Object.assign(state, { lastWrite: new Date(clock()).toISOString(), error: '', failedAt: undefined });
            } catch (error) {
                failure(error);
                if (error.code === 'WRITE_TIMEOUT') { halt?.(error); }
                throw error;
            }
        }
    };
}

/** Consume acknowledged telemetry and measure ingest health at the storage boundary. */
export default function telemetryIngest(url, queue, metrics, settings = {}) {
    const { clock = Date.now, halt, connect = amqpMetricsIngest, report, ...options } = settings;
    const config = batchConfig(options);
    const state = { started: false, records: 0, batches: 0, lastWrite: undefined, error: '', failedAt: undefined };
    function failure(error) {
        state.failedAt ??= clock();
        if (state.error !== error.message) { report?.(error); }
        state.error = error.message;
    }
    const sink = metricBatches(metrics, state, clock, failure, halt);
    const input = connect(url, queue, sink, { ...config,
        exclusive: true, stopTimeoutMs: 50000, maxMessageBytes: 65536, maxPendingBytes: 8388608,
        maxBytes: 1048576, maxRecords: 1024, onError: failure
    });
    return {
        async start() { await input.start(); Object.assign(state, { started: true }); },
        async stop() { state.started = false; await input.stop(); },
        status() {
            return { ...state, ready: state.started && !state.error, live: state.failedAt === undefined || clock() - state.failedAt < 60000 };
        }
    };
}
