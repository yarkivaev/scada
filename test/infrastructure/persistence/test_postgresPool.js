import assert from 'assert';
import postgresPool from '../../../src/infrastructure/persistence/postgresPool.js';

describe('postgresPool', function() {
    it('survives an idle client error', async function() {
        const noise = `печь-${Math.random().toString(36).slice(2)}`;
        const pool = postgresPool({
            connectionString: `postgres://external:secret@database.example.test:5432/${noise}`
        });
        const { write } = process.stderr;
        process.stderr.write = () => {
            return true;
        };
        pool.emit('error', new Error(`Connection terminated unexpectedly ${noise}`));
        process.stderr.write = write;
        await pool.end();
        assert.strictEqual(pool.listenerCount('error'), 1, 'idle postgres client error still crashes the process');
    });
});
