/**
 * Metrics port used when SINK_DB_PROFILE is central (ClickHouse owns metrics).
 */
export default function metricsStateDisabled() {
    return {
        latestForTopic() {
            return Promise.resolve(null);
        },
        rangeForTopic() {
            return Promise.resolve([]);
        },
        pollTopic() {
            return Promise.resolve([]);
        },
        insertRows() {
            return Promise.reject(new Error('metrics storage is disabled on central profile'));
        }
    };
}
