/**
 * One in-flight callback per SQL engine.
 *
 * ClickHouse and Postgres each keep a tail promise. A later job waits for
 * that tail before it runs, so two query tools never execute together.
 *
 * @returns {object} run(engine, job)
 *
 * @example
 *   const flight = mcpFlight();
 *   await flight.run('clickhouse', () => query('SELECT 1'));
 */
export default function mcpFlight() {
    const tail = {
        clickhouse: Promise.resolve(),
        postgres: Promise.resolve()
    };
    return Object.freeze({
        /**
         * Runs job after the previous job for this engine settles.
         *
         * @param {string} engine - clickhouse or postgres
         * @param {Function} job - callback
         * @returns {Promise<*>} job result
         */
        run(engine, job) {
            const prior = tail[engine];
            let release;
            const held = new Promise((resolve) => {
                release = resolve;
            });
            tail[engine] = prior.then(() => {
                return held;
            }, () => {
                return held;
            });
            return prior.then(job, job).finally(() => {
                release();
            });
        }
    });
}
