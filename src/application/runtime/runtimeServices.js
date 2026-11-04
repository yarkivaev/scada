import pg from 'pg';
import taskStatePg from '../../infrastructure/persistence/runtime/taskStatePg.js';
import deadline from './deadline.js';
import queuedDelivery from './queuedDelivery.js';

/** Storage is optional for live-only tasks and mandatory for durable adapters. */
export default function runtimeServices(env, supplied) {
    const pool = !supplied.stateStore && env.COLLECTOR_STATE_URL ? new pg.Pool({
        connectionString: env.COLLECTOR_STATE_URL, max: 4, connectionTimeoutMillis: 5000,
        query_timeout: 10000, statement_timeout: 10000, idleTimeoutMillis: 30000
    }) : null;
    const secrets = supplied.secrets ?? { get(name) { return env[name]; } };
    const delivery = queuedDelivery(env, secrets, supplied.deliveryQueue);
    return { ...supplied, secrets, deliveryQueue: delivery.queue,
        open() { return delivery.open(); },
        stateStore: supplied.stateStore ?? (pool ? taskStatePg(pool) : undefined),
        async close() { await delivery.stop(); if (pool) { await deadline(() => { return pool.end(); }, 10000); } }
    };
}
