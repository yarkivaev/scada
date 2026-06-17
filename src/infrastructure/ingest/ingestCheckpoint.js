import { ingestCursorAt, ingestCursorEmpty } from '../../domain/ingest/ingestCursor.js';

function findRow(store, source, machine) {
    return store.checkpoints.find((row) => {
        return row.source === source && row.machine === machine;
    });
}

/**
 * In-memory ingest checkpoint port for tests and local runs.
 *
 * @param {object} store - shared store with checkpoints array
 * @returns {object} checkpoint port with read and write methods
 */
export default function ingestCheckpointMemory(store) {
    if (!store.checkpoints) {
        store.checkpoints = [];
    }
    return {
        read(source, machine) {
            const row = findRow(store, source, machine);
            if (!row) {
                return Promise.resolve(ingestCursorEmpty());
            }
            return Promise.resolve(ingestCursorAt(new Date(row.cursor_at)));
        },
        write(source, machine, cursorAt) {
            const row = findRow(store, source, machine);
            if (row) {
                row.cursor_at = new Date(cursorAt);
                return Promise.resolve();
            }
            store.checkpoints.push({
                source,
                machine,
                cursor_at: new Date(cursorAt)
            });
            return Promise.resolve();
        }
    };
}

/**
 * PostgreSQL ingest checkpoint port backed by ingest_checkpoints table.
 *
 * @param {object} pool - pg pool with query method
 * @returns {object} checkpoint port with read and write methods
 */
export function ingestCheckpointPg(pool) {
    return {
        read(source, machine) {
            return pool.query(
                'SELECT cursor_at FROM ingest_checkpoints WHERE source = $1 AND machine = $2',
                [source, machine]
            ).then((result) => {
                if (result.rows.length === 0) {
                    return ingestCursorEmpty();
                }
                return ingestCursorAt(new Date(result.rows[0].cursor_at));
            });
        },
        write(source, machine, cursorAt) {
            return pool.query(
                `INSERT INTO ingest_checkpoints (source, machine, cursor_at)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (source, machine) DO UPDATE SET cursor_at = EXCLUDED.cursor_at`,
                [source, machine, cursorAt]
            );
        }
    };
}
