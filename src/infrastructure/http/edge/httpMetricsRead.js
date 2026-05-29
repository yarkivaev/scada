/**
 * Read port adapter for supervisor-sink metrics HTTP API.
 *
 * @param {object} client - stateHttpClient
 * @returns {object} read port for metricsSensor
 */
export default function httpMetricsRead(client) {
    return {
        async current(topic) {
            const data = await client.getJson('/v1/metrics/current', { topic });
            if (!data.found) {
                return { found: false };
            }
            return { found: true, ts: data.ts, value: data.value };
        },
        async range(topic, startIso, endIso, stepMs) {
            const data = await client.getJson('/v1/metrics/range', {
                topic,
                start: startIso,
                end: endIso,
                stepMs: String(stepMs)
            });
            return data.items;
        },
        async poll(topic, afterIso, untilIso) {
            const data = await client.getJson('/v1/metrics/poll', {
                topic,
                after: afterIso,
                until: untilIso
            });
            return data.items;
        }
    };
}
