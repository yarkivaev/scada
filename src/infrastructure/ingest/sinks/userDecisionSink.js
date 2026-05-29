import processingErrorLog from '../processingErrorLog.js';

/**
 * Sink for inserting user tag decisions into the user_decisions audit table.
 *
 * Each accepted record is persisted as a row with machine, start_time,
 * username, and the full raw JSON payload. Does not modify the segments table.
 *
 * @example
 *   const pool = new pg.Pool({ connectionString: url });
 *   const sink = userDecisionSink(pool);
 *   sink.accept({ machine: 'icht2', startTime: '2024-01-01T00:00:00.000Z',
 *                 username: 'operator1', payload: '{"tags":["charge_loading"]}' });
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
         * @param {object} record - Record with machine, startTime, username, payload
         */
        async accept({ machine, startTime, username, payload }) {
            try {
                await pool.query(
                    'INSERT INTO user_decisions (machine, start_time, username, payload) VALUES ($1, $2, $3, $4)',
                    [machine, startTime, username, payload]
                );
            } catch (error) {
                processingErrorLog('decision_sink_insert', error, { machine, startTime, username, payload });
                throw error;
            }
        }
    };
}
