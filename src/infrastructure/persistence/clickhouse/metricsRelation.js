/**
 * Additive read relation: legacy rows remain untouched, canonical retries are
 * invisible before background merges. Pre-upgrade conflicts have no arrival
 * ordering; their selected legacy value is unspecified, never claimed first.
 */
export default `(SELECT topic,ts,argMin(value,priority) AS value FROM (
    SELECT topic,ts,value,0 AS priority FROM scada.metrics
    UNION ALL
    SELECT topic,ts,value,1 AS priority FROM scada.metrics_canonical FINAL
) GROUP BY topic,ts)`;
