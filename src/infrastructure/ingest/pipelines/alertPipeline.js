import { stompSource } from '@yarkivaev/source-to-sink';
import alertCodec from '../codecs/alertCodec.js';
import alertSink from '../sinks/alertSink.js';

/**
 * Pipeline for streaming STOMP alert data to PostgreSQL alerts table.
 *
 * Subscribes to STOMP exchange and forwards alert messages directly
 * to the alert sink without batching. Alerts are rare and require
 * per-record INSERT/UPDATE branching, making batching unnecessary.
 *
 * Plant packages pass human-readable messages via config.translations
 * (rule name → message). Without translations, the rule name is stored.
 *
 * @example
 *   const pipeline = alertPipeline(
 *     'stomp://rabbitmq:61613',
 *     pool,
 *     { login: 'guest', passcode: 'guest', host: '/', translations: { no_data: 'No data' } }
 *   );
 *   pipeline.start();
 *
 * @param {string} stomp - STOMP broker URL
 * @param {object} pool - PostgreSQL pool
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
export default function alertPipeline(stomp, pool, config) {
    const sink = alertSink(pool);
    const codec = alertCodec(sink, config.translations || {});
    const source = stompSource(stomp, '/exchange/scada.alerts', codec,
        { login: config.login, passcode: config.passcode, host: config.host });
    return {
        /**
         * Starts the pipeline.
         */
        start() {
            source.start();
        },
        /**
         * Stops the pipeline.
         */
        stop() {
            source.stop();
            sink.stop();
        }
    };
}
