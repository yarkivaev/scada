import assert from 'node:assert/strict';
import segmentDispatch from '../../../../src/domain/segment/dispatch.js';
import { postgresSink } from '../../../../src/infrastructure/streams/index.js';
import retagSink from '../../../../src/infrastructure/ingest/sinks/retagSink.js';
import closeOrphanOpen from '../../../../src/infrastructure/ingest/sinks/closeOrphanOpen.js';
import continuedSegments from '../../../../src/infrastructure/ingest/sinks/continuedSegments.js';
import { segmentColumns, segmentConflict, segmentUpdateColumns, splitUpdateColumns } from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

const row = { type: 'segment', machine: 'fixture', kind: 'phase', name: 'off',
    start_time: '2024-01-01T00:00:00.000Z', end_time: '2024-01-01T00:01:00.000Z',
    duration: 60, tags: '["operator"]', properties: '{}', options: null, resolved: true };
describe('segment commands in an owned transaction', () => {
    for (const type of ['segment', 'pending', 'split', 'retag', 'split-family']) {
        it(`uses the supplied transaction for ${type} without starting another one`, async () => {
            const forbidden = () => { throw new Error('operation escaped the owned transaction'); };
            const pool = { query: forbidden, connect: forbidden };
            const statements = [];
            const client = { async query(sql) { statements.push(sql);return { rows: [], rowCount: 0 }; } };
            const segment = postgresSink('postgres://fixture', 'segments', segmentColumns,
                { pool, conflict: segmentConflict, update: segmentUpdateColumns });
            const split = postgresSink('postgres://fixture', 'segments', segmentColumns,
                { pool, conflict: segmentConflict, update: splitUpdateColumns });
            const dispatch = segmentDispatch(continuedSegments(segment, pool, 30), retagSink(pool), split, closeOrphanOpen(pool), pool);
            let record = { ...row, type };
            if (type === 'pending') { record = { ...row, duration: 0 }; }
            if (type === 'split-family') { record = { type, machine: row.machine, origin: 1704067200000, pieces: [{ ...row, type: 'split' }] }; }
            await dispatch.accept(record, client);
            assert.ok(statements.some(sql => {return /UPDATE segments|INSERT INTO segments/u.test(sql)}));
            assert.equal(statements.some(sql => {return /^(?:BEGIN|COMMIT|ROLLBACK)$/u.test(sql)}), false);
        });
    }
});
