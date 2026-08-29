function wantedKinds(range) {
    if (range && Array.isArray(range.kinds) && range.kinds.length > 0) {
        return range.kinds;
    }
    return ['phase'];
}

function listSql(machineId, range) {
    let sql = `SELECT s.kind, s.name, s.start_time, s.end_time, s.duration, s.options, s.tags, s.properties
                FROM segments s WHERE s.machine = $1`;
    const prm = [machineId];
    prm.push(wantedKinds(range));
    sql += ` AND s.kind = ANY($2)`;
    if (range.from) {
        prm.push(range.from);
        sql += ` AND (s.end_time >= $${prm.length} OR s.duration = 0)`;
    }
    if (range.to) {
        prm.push(range.to);
        sql += ` AND s.start_time <= $${prm.length}`;
    }
    sql += ' ORDER BY s.start_time';
    return { sql, prm };
}

function reads(pool) {
    return {
        async listForMachine(machineId, range) {
            const query = listSql(machineId, range || {});
            const result = await pool.query(query.sql, query.prm);
            return result.rows;
        },
        async latestForKinds(machineId, kinds) {
            if (!Array.isArray(kinds) || kinds.length === 0) {
                return [];
            }
            const result = await pool.query(
                `SELECT DISTINCT ON (kind) kind, name, start_time, end_time, duration, options, tags, properties
                 FROM segments WHERE machine = $1 AND kind = ANY($2)
                 ORDER BY kind, start_time DESC`,
                [machineId, kinds]
            );
            return result.rows;
        },
        async rowAt(machineId, start) {
            const result = await pool.query(
                `SELECT kind, name, start_time, end_time, duration, options, tags, properties
                 FROM segments WHERE machine = $1 AND start_time = $2 AND kind = 'phase'`,
                [machineId, start]
            );
            return result.rows[0] ?? null;
        },
        async pendingRequestsForMachine(machineId) {
            const result = await pool.query(
                `SELECT start_time AS id, name, start_time, end_time, duration, options
                 FROM segments WHERE machine = $1 AND resolved = FALSE AND kind = 'phase'
                 ORDER BY start_time`,
                [machineId]
            );
            return result.rows;
        }
    };
}

function writes(pool) {
    return {
        async retag(machineId, start, tagsJson, propertiesJson) {
            const result = await pool.query(
                `UPDATE segments SET tags = $1, properties = $2
                 WHERE machine = $3 AND start_time = $4 AND kind = 'phase'`,
                [tagsJson, propertiesJson, machineId, start]
            );
            return result.rowCount;
        },
        async resolveRequest(machineId, startKey, tagsJson, propertiesJson) {
            const result = await pool.query(
                `UPDATE segments SET tags = $1, properties = $2, resolved = TRUE, consumed = FALSE
                 WHERE machine = $3 AND start_time = $4 AND kind = 'phase'`,
                [tagsJson, propertiesJson, machineId, startKey]
            );
            return result.rowCount;
        }
    };
}

export default function segmentStatePg(pool) {
    return { ...reads(pool), ...writes(pool) };
}
