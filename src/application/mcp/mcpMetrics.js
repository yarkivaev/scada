/**
 * Escapes a Prometheus label value.
 *
 * @param {string} value - raw label
 * @returns {string} escaped label
 *
 * @example
 *   escapeLabel('query_clickhouse');
 */
function escapeLabel(value) {
    return String(value).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n');
}

/**
 * Renders counters and gauges as Prometheus text.
 *
 * @param {Map<string, number>} calls - tool and status counts
 * @param {object} inflight - counts by engine
 * @returns {string} exposition
 *
 * @example
 *   render(new Map(), { clickhouse: 0, plant: 0, postgres: 0 });
 */
function render(calls, inflight) {
    const lines = ['# TYPE mcp_calls_total counter'];
    for (const [key, count] of calls) {
        const parts = key.split('\u0000');
        lines.push(`mcp_calls_total{tool="${escapeLabel(parts[0])}",status="${escapeLabel(parts[1])}"} ${count}`);
    }
    lines.push('# TYPE mcp_inflight gauge');
    lines.push(`mcp_inflight{engine="clickhouse"} ${inflight.clickhouse}`);
    lines.push(`mcp_inflight{engine="plant"} ${inflight.plant}`);
    lines.push(`mcp_inflight{engine="postgres"} ${inflight.postgres}`);
    return `${lines.join('\n')}\n`;
}

/**
 * Prometheus text for analytics MCP calls.
 *
 * Labels are tool and status on the counter, and engine on the in-flight gauge.
 * Caller, machine, and SQL are not labels.
 *
 * @returns {object} begin, end, mark, and text
 *
 * @example
 *   const metrics = mcpMetrics();
 *   metrics.mark('state', 'ok');
 *   metrics.text();
 */
export default function mcpMetrics() {
    const calls = new Map();
    const inflight = { clickhouse: 0, plant: 0, postgres: 0 };
    return Object.freeze({
        begin(engine) {
            inflight[engine] += 1;
        },
        end(engine) {
            inflight[engine] -= 1;
        },
        mark(tool, status) {
            const key = `${tool}\u0000${status}`;
            const count = calls.get(key) || 0;
            calls.set(key, count + 1);
        },
        text() {
            return render(calls, inflight);
        }
    });
}
