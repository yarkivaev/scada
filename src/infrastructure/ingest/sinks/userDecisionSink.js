import processingErrorLog from '../processingErrorLog.js';
import { applyDecision } from './decisionSegment.js';

/**
 * Sink for operator decisions from the user_decisions queue.
 *
 * The decision is applied to segments first, then appended to the audit table.
 * A tag list replaces stored tags. A split rewrites the matching off family.
 *
 * @example
 *   const sink = userDecisionSink(pool);
 *   sink.accept({ machine: 'm2', startTime: '2024-01-01T00:00:00.000Z',
 *                 username: 'Ivan Petrov', operatorId: 2,
 *                 decidedAt: '2024-01-01T00:01:00.000Z',
 *                 payload: '{"tags":["charge_loading"]}' });
 *
 * @param {object} pool - pg Pool (or compatible) with query() method
 * @returns {object} Sink with accept() method
 */
export default function userDecisionSink(pool) {
    if (!pool || typeof pool.query !== 'function') {
        throw new Error('Pool must have a query() method');
    }
    return {
        /**
         * Applies the decision to segments, then inserts the audit row.
         *
         * @param {object} record - machine, startTime, username, operatorId, decidedAt, payload
         */
        async accept({ machine, startTime, username, operatorId, decidedAt, payload }) {
            const context = { machine, startTime, username, operatorId, decidedAt, payload };
            try {
                await applyDecision(pool, machine, startTime, payload);
            } catch (error) {
                if (!(error instanceof RangeError)) {
                    processingErrorLog('decision_sink_insert', error, context);
                    throw error;
                }
                processingErrorLog('decision_sink_refused', error, context);
            }
            try {
                await pool.query(
                    'INSERT INTO user_decisions (machine, start_time, username, operator_id, decided_at, payload) VALUES ($1, $2, $3, $4, $5, $6)',
                    [machine, startTime, username, operatorId ?? null, decidedAt, payload]
                );
            } catch (error) {
                processingErrorLog('decision_sink_insert', error, context);
                throw error;
            }
        }
    };
}
