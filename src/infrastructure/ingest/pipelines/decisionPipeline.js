import { stompSource } from '@yarkivaev/source-to-sink';
import userDecisionCodec from '../codecs/userDecisionCodec.js';
import userDecisionSink from '../sinks/userDecisionSink.js';

/**
 * Pipeline for logging operator tag decisions from RabbitMQ to PostgreSQL.
 *
 * Subscribes to the user_decisions STOMP exchange and inserts each received
 * decision into the user_decisions audit table. Decisions carry machine,
 * start timestamp, operator identity, and full JSON payload.
 *
 * @example
 *   const pipeline = decisionPipeline(
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
export default function decisionPipeline(stomp, pool, config) {
    const sink = userDecisionSink(pool);
    const codec = userDecisionCodec(sink);
    const source = stompSource(stomp, '/exchange/scada.user_decisions', codec,
        { login: config.login, passcode: config.passcode, host: config.host });
    return {
        /**
         * Starts consuming user decisions from RabbitMQ.
         */
        start() {
            source.start();
        },
        /**
         * Stops consuming and releases resources.
         */
        stop() {
            source.stop();
            pool.end();
        }
    };
}
