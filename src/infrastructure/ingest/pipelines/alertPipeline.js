/**
 * Pipeline for streaming STOMP alert data to PostgreSQL alerts table.
 *
 * Subscribes to STOMP exchange and forwards alert messages directly
 * to the alert sink without batching. Alerts are rare and require
 * per-record INSERT/UPDATE branching, making batching unnecessary.
 *
 * @example
 *   const pipeline = alertPipeline(
 *     'stomp://rabbitmq:61613',
 *     'postgresql://scada:scada@postgres/scada',
 *     { login: 'guest', passcode: 'guest', host: '/' }
 *   );
 *   pipeline.start();
 *
 * @param {string} stomp - STOMP broker URL
 * @param {string} postgres - PostgreSQL connection URL
 * @param {object} config - Pipeline configuration
 * @returns {object} Pipeline with start() and stop() methods
 */
import { stompSource } from '@yarkivaev/source-to-sink';
import alertCodec from '../codecs/alertCodec.js';
import alertSink from '../sinks/alertSink.js';

const translations = {
    low_cosphi: 'Выключить переключатель компенсации',
    high_cosphi: 'Включить переключатель компенсации',
    no_data: 'Нет данных от источника'
};

export default function alertPipeline(stomp, pool, config) {
    const sink = alertSink(pool);
    const codec = alertCodec(sink, translations);
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
