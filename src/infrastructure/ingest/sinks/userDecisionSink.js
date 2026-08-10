import processingErrorLog from '../processingErrorLog.js';

/**
 * Sink for inserting user tag decisions into the user_decisions audit table.
 *
 * Each accepted record is persisted with machine, start_time, username,
 * operator_id, decided_at, and the full raw JSON payload.
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
         * Inserts a user decision record into the user_decisions table.
         *
         * @param {object} record - machine, startTime, username, operatorId, decidedAt, payload
         */
        async accept({ machine, startTime, username, operatorId, decidedAt, payload }) {
            try {
                await pool.query(
                    'INSERT INTO user_decisions (machine, start_time, username, operator_id, decided_at, payload) VALUES ($1, $2, $3, $4, $5, $6)',
                    [machine, startTime, username, operatorId ?? null, decidedAt, payload]
                );
            } catch (error) {
                processingErrorLog('decision_sink_insert', error, { machine, startTime, username, operatorId, decidedAt, payload });
                throw error;
            }
        }
    };
}
