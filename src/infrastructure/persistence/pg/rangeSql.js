/**
 * Downsampled Postgres range for one metrics topic.
 *
 * $1 interval, $2 topic, $3 start, $4 end.
 *
 * @returns {string} SQL
 */
export default function rangeSql() {
    return `SELECT bucket AS ts, value FROM (
            SELECT date_bin($1::interval, ts, '1970-01-01'::timestamptz) AS bucket, value,
                   ROW_NUMBER() OVER (PARTITION BY date_bin($1::interval, ts, '1970-01-01'::timestamptz) ORDER BY ts DESC) AS rn
            FROM metrics WHERE topic = $2 AND ts >= $3 AND ts <= $4
        ) sub WHERE rn = 1 ORDER BY ts`;
}
