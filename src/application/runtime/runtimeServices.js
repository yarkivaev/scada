import pg from 'pg';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import taskStatePg from '../../infrastructure/persistence/runtime/taskStatePg.js';
import taskStateSqlite from '../../infrastructure/persistence/runtime/taskStateSqlite.js';
import deadline from './deadline.js';
import queuedDelivery from './queuedDelivery.js';

function localStore(env, supplied) {
    if (!supplied.localTaskState || supplied.stateStore || env.COLLECTOR_STATE_URL || !env.COLLECTOR_SPOOL_DIR) {
        return undefined;
    }
    mkdirSync(env.COLLECTOR_SPOOL_DIR, { recursive: true });
    return taskStateSqlite(join(env.COLLECTOR_SPOOL_DIR, 'task-state.sqlite'));
}

/** Storage is optional for live-only tasks and mandatory for durable adapters. */
export default function runtimeServices(env, supplied) {
    const pool = !supplied.stateStore && env.COLLECTOR_STATE_URL ? new pg.Pool({
        connectionString: env.COLLECTOR_STATE_URL, max: 4, connectionTimeoutMillis: 5000,
        query_timeout: 10000, statement_timeout: 10000, idleTimeoutMillis: 30000
    }) : null;
    const secrets = supplied.secrets ?? { get(name) { return env[name]; } };
    const delivery = queuedDelivery(env, secrets, supplied.deliveryQueue);
    const local = localStore(env, supplied);
    return { ...supplied, secrets, deliveryQueue: delivery.queue,
        open() { return delivery.open(); },
        stateStore: supplied.stateStore ?? (pool ? taskStatePg(pool) : local),
        async close() {
            try { await delivery.stop(); }
            finally {
                local?.close();
                if (pool) { await deadline(() => { return pool.end(); }, 10000); }
            }
        }
    };
}
