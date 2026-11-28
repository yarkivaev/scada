import pg from 'pg';

function connect({ connectionString, onDatabaseError, poolOptions }) {
    const pool = new pg.Pool({ connectionString, max: 2, options: '-c statement_timeout=20000', connectionTimeoutMillis: 10000, ...poolOptions });
    pool.on('error', () => { onDatabaseError?.(); });
    return pool;
}

function listen(server, { port, host = '127.0.0.1' }, pool, worker) {
    const number = Number(port);
    if (!Number.isSafeInteger(number) || number < 1 || number > 65535) { throw new Error('PostgreSQL snapshot server port is invalid'); }
    server.listen(number, host);
    function close() { server.close(); }
    async function release() {
        process.off('SIGTERM', close);
        process.off('SIGINT', close);
        if (worker) { await worker.stop(); }
        await pool.end();
    }
    server.once('close', () => { void release(); });
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    return server;
}

export function servePostgresSnapshot(settings, createServer) {
    const pool = connect(settings);
    try { return listen(createServer(pool), settings, pool); }
    catch (error) { void pool.end(); throw error; }
}

export async function followPostgresSnapshot(settings, createWorker) {
    const pool = connect(settings);
    try {
        const worker = await createWorker(pool);
        const server = listen(worker.server, settings, pool, worker);
        worker.start();
        return server;
    } catch (error) { await pool.end(); throw error; }
}
