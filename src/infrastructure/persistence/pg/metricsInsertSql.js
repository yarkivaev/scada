/** First-wins receipt and raw metric commit in the same statement, including history triggers. */
export default function metricsInsertSql(firstWins) {
    return firstWins ? `WITH incoming AS (
                    SELECT DISTINCT ON (topic,ts) topic,ts,value FROM unnest($1::text[], $2::timestamptz[], $3::float8[]) WITH ORDINALITY AS rows(topic,ts,value,position) ORDER BY topic,ts,position
                ), accepted AS (
                    INSERT INTO metric_receipts(topic,ts,value)
                    SELECT i.topic,i.ts,COALESCE((SELECT m.value FROM metrics m WHERE m.topic=i.topic AND m.ts=i.ts LIMIT 1),i.value) FROM incoming i
                    ON CONFLICT(topic,ts) DO NOTHING RETURNING topic,ts,value
                ) INSERT INTO metrics(topic,ts,value) SELECT a.topic,a.ts,a.value FROM accepted a
                  WHERE NOT EXISTS(SELECT 1 FROM metrics m WHERE m.topic=a.topic AND m.ts=a.ts)`
                    : 'INSERT INTO metrics (topic, ts, value) SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::float8[])';
}
