import assert from 'assert';
import ingestCheckpointStatePg from '../../../../src/infrastructure/persistence/pg/ingestCheckpoints.js';

describe('pgIngestCheckpoints upsert', function() {
    it('uses machine and kind conflict target for cursor upsert', async function() {
        const queries = [];
        const pool = {
            async query(sql, params) {
                queries.push({ sql, params });
            }
        };
        const store = ingestCheckpointStatePg(pool);
        const cursor = new Date('2024-06-01T10:00:00.000Z');
        await store.upsert('icht1', 'chem', cursor);
        assert(queries[0].sql.includes('ON CONFLICT (machine, kind)'), 'checkpoint upsert must target machine and kind');
    });
});
