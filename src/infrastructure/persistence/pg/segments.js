export default function segmentStatePg(pool) {
    return {
        async listForMachine(machineId, range) {
            let sql = `SELECT s.name, s.start_time, s.end_time, s.duration, s.options, s.tags, s.properties
                FROM segments s WHERE s.machine = $1`;
            const prm = [machineId];
            if (range.from) {
                prm.push(range.from);
                sql += ` AND (s.end_time >= $${prm.length} OR s.duration = 0)`;
            }
            if (range.to) {
                prm.push(range.to);
                sql += ` AND s.start_time <= $${prm.length}`;
            }
            sql += ' ORDER BY s.start_time';
            const result = await pool.query(sql, prm);
            return result.rows;
        },
        async rowAt(machineId, start) {
            const result = await pool.query(
                `SELECT name, start_time, end_time, duration, options, tags, properties
                 FROM segments WHERE machine = $1 AND start_time = $2`,
                [machineId, start]
            );
            return result.rows[0] ?? null;
        },
        async pendingRequestsForMachine(machineId) {
            const result = await pool.query(
                `SELECT start_time AS id, name, start_time, end_time, duration, options
                 FROM segments WHERE machine = $1 AND resolved = FALSE ORDER BY start_time`,
                [machineId]
            );
            return result.rows;
        },
        async retag(machineId, start, tagsJson, propertiesJson) {
            const result = await pool.query(
                'UPDATE segments SET tags = $1, properties = $2 WHERE machine = $3 AND start_time = $4',
                [tagsJson, propertiesJson, machineId, start]
            );
            return result.rowCount;
        },
        async resolveRequest(machineId, startKey, tagsJson, propertiesJson) {
            const result = await pool.query(
                'UPDATE segments SET tags = $1, properties = $2, resolved = TRUE, consumed = FALSE WHERE machine = $3 AND start_time = $4',
                [tagsJson, propertiesJson, machineId, startKey]
            );
            return result.rowCount;
        }
    };
}
