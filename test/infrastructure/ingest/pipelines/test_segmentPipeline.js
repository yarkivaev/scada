import assert from 'assert';
import segmentPipeline, {
    segmentConflict,
    segmentUpdateColumns,
    segmentUpdateWhere,
    segmentsIngestDestination,
    splitUpdateColumns
} from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

function allows(existing, incoming) {
    const later = Date.parse(incoming.end_time) > Date.parse(existing.end_time);
    const equal = Date.parse(incoming.end_time) === Date.parse(existing.end_time);
    return later || (equal && (incoming.duration >= existing.duration || existing.duration === 0));
}

function upsertStore(conflict, update) {
    const rows = new Map();
    return {
        rows,
        write(records) {
            for (const record of records) {
                const key = conflict.map((col) => { return record[col]; }).join('\u0000');
                const existing = rows.get(key);
                if (!existing) {
                    rows.set(key, { ...record });
                } else if (allows(existing, record)) {
                    const merged = { ...existing };
                    for (const col of update) {
                        merged[col] = record[col];
                    }
                    rows.set(key, merged);
                }
            }
            return Promise.resolve();
        }
    };
}

describe('segmentPipeline regular segment upsert', function() {
    it('keeps operator tags when a later segment message carries an empty tag list', async function() {
        const machine = `ičt-${Math.random()}`;
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        const operatorTags = JSON.stringify([`heating_${Math.random()}`]);
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        await store.write([{ machine, kind: 'phase', name: 'on', start_time: start, end_time: start,
            duration: 60, options: null, tags: operatorTags, properties: '{}', resolved: true }]);
        await store.write([{ machine, kind: 'phase', name: 'on', start_time: start, end_time: start,
            duration: 65, options: null, tags: '[]', properties: null, resolved: true }]);
        assert.strictEqual(
            store.rows.get(`${machine}\u0000phase\u0000${start}`).tags,
            operatorTags,
            'segment replay cleared an operator tag'
        );
    });
});

describe('segmentPipeline upsert configuration', function() {
    it('does not list tags column in regular segment upsert update set', function() {
        assert.ok(
            !segmentUpdateColumns.includes('tags'),
            'regular segment replay would overwrite operator tags'
        );
    });

    it('does not list properties column in regular segment upsert update set', function() {
        assert.ok(
            !segmentUpdateColumns.includes('properties'),
            'regular segment UPSERT must not overwrite operator properties'
        );
    });

    it('updates end_time on regular segment conflict', function() {
        assert.ok(
            segmentUpdateColumns.includes('end_time'),
            'regular segment UPSERT must extend end_time for growing intervals'
        );
    });

    it('keeps tags column in split upsert update set', function() {
        assert.ok(
            splitUpdateColumns.includes('tags'),
            'split UPSERT must write operator-supplied sub-segment tags'
        );
    });

    it('conflicts on machine kind and start_time', function() {
        assert.deepStrictEqual(
            segmentConflict,
            ['machine', 'kind', 'start_time'],
            'segment upsert must include kind in the conflict key'
        );
    });

    it('subscribes to the durable segments ingest queue by default', function() {
        assert.strictEqual(
            segmentsIngestDestination,
            '/queue/scada.segments.ingest',
            'segment ingest must not use an ephemeral exchange subscription'
        );
    });

    it('guards conflict update so a stale pending cannot reopen a completed span', function() {
        assert.strictEqual(
            segmentUpdateWhere,
            '(EXCLUDED.end_time > segments.end_time OR (EXCLUDED.end_time = segments.end_time AND (EXCLUDED.duration >= segments.duration OR segments.duration = 0))) AND NOT (segments.duration > 0 AND EXCLUDED.duration = 0 AND COALESCE(segments.properties, \'\') LIKE \'%"split_of"%\' AND EXISTS (SELECT 1 FROM segments AS kin WHERE kin.machine = segments.machine AND kin.kind = segments.kind AND kin.start_time > segments.start_time AND COALESCE(kin.properties, \'\') LIKE \'%"split_of"%\'))',
            'segment upsert must keep a completed span against a pending heartbeat that is not later'
        );
    });

    it('refreshes updated_at when a segment row is upserted', function() {
        assert.ok(
            segmentUpdateColumns.includes('updated_at'),
            'segment upsert must record the wall-clock time of the last heartbeat'
        );
    });
});

describe('segmentPipeline monotonic upsert', function() {
    it('does not let a late pending reopen a completed segment', async function() {
        const machine = `ičt-${Math.random()}`;
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        const span = 3000 + Math.floor(Math.random() * 800);
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: start, duration: span, options: null, tags: null,
            properties: '{}', resolved: true
        }]);
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: start, duration: 0, options: null, tags: null,
            properties: '{}', resolved: true
        }]);
        assert.strictEqual(
            store.rows.get(`${machine}\u0000phase\u0000${start}`).duration,
            span,
            'pending heartbeat reopened a completed segment'
        );
    });

    it('reopens a closed segment when a later heartbeat continues it', async function() {
        const machine = `ičt-${Math.random()}`;
        const start = new Date(1_700_000_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const frozen = new Date(Date.parse(start) + 12_000).toISOString();
        const next = new Date(Date.parse(start) + 47_000).toISOString();
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: frozen, duration: 12, options: null, tags: null,
            properties: '{}', resolved: true
        }]);
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: next, duration: 0, options: null, tags: null,
            properties: '{}', resolved: true, updated_at: next
        }]);
        const row = store.rows.get(`${machine}\u0000phase\u0000${start}`);
        assert.strictEqual(row.end_time, next, 'later heartbeat did not extend a silence-closed segment');
    });

    it('lets a late close replace an orphan one-second stub', async function() {
        const machine = `ičt-${Math.random()}`;
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        const span = 2000 + Math.floor(Math.random() * 900);
        const ended = new Date(Date.parse(start) + span * 1000).toISOString();
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: new Date(Date.parse(start) + 1000).toISOString(),
            duration: 1, options: null, tags: null, properties: '{}', resolved: true
        }]);
        await store.write([{
            machine, kind: 'phase', name: 'on', start_time: start,
            end_time: ended, duration: span, options: null, tags: null,
            properties: '{}', resolved: true
        }]);
        assert.strictEqual(
            store.rows.get(`${machine}\u0000phase\u0000${start}`).duration,
            span,
            'completed close did not overwrite the orphan one-second stub'
        );
    });

    it('does not let an earlier one-second close shrink a later extension', async function() {
        const machine = `cm-${Math.random()}`;
        const start = new Date(1_700_000_000_000 + Math.floor(Math.random() * 1e8)).toISOString();
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        const span = 20000 + Math.floor(Math.random() * 900);
        const ended = new Date(Date.parse(start) + span * 1000).toISOString();
        await store.write([{
            machine, kind: 'phase', name: 'off', start_time: start,
            end_time: ended, duration: span, options: null, tags: null,
            properties: '{}', resolved: true
        }]);
        await store.write([{
            machine, kind: 'phase', name: 'off', start_time: start,
            end_time: new Date(Date.parse(start) + 1000).toISOString(),
            duration: 1, options: null, tags: null, properties: '{}', resolved: true
        }]);
        assert.strictEqual(
            store.rows.get(`${machine}\u0000phase\u0000${start}`).duration,
            span,
            'stale one-second close shrank a later covering off'
        );
    });
});

it('rejects malformed startup history policy before connecting',()=>{
    for(const repairHistoryOnStart of ['false',null,0]){
        assert.throws(()=>{return segmentPipeline('stomp://fixture','postgres://fixture',{}, {repairHistoryOnStart})},/repairHistoryOnStart must be boolean/u);
    }
});
