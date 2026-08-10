import assert from 'assert';
import {
    segmentConflict,
    segmentUpdateColumns,
    segmentsIngestDestination,
    splitUpdateColumns
} from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

function upsertStore(conflict, update) {
    const rows = new Map();
    return {
        rows,
        write(records) {
            for (const record of records) {
                const key = conflict.map((col) => { return record[col]; }).join('\u0000');
                const existing = rows.get(key);
                if (existing) {
                    const merged = { ...existing };
                    for (const col of update) {
                        merged[col] = record[col];
                    }
                    rows.set(key, merged);
                } else {
                    rows.set(key, { ...record });
                }
            }
            return Promise.resolve();
        }
    };
}

describe('segmentPipeline regular segment upsert', function() {
    it('keeps operator tags when a regular segment message replays the same row', async function() {
        const machine = `ičt-${Math.random()}`;
        const start = new Date(Math.floor(Math.random() * 1e12)).toISOString();
        const operatorTags = JSON.stringify([`heating_${Math.random()}`]);
        const store = upsertStore(segmentConflict, segmentUpdateColumns);
        await store.write([{ machine, name: 'on', start_time: start, end_time: start,
            duration: 60, options: null, tags: operatorTags, properties: '{}', resolved: true }]);
        await store.write([{ machine, name: 'on', start_time: start, end_time: start,
            duration: 65, options: null, tags: null, properties: null, resolved: true }]);
        assert.strictEqual(
            store.rows.get(`${machine}\u0000${start}`).tags,
            operatorTags,
            'regular segment upsert must not clobber operator-applied tags'
        );
    });
});

describe('segmentPipeline upsert configuration', function() {
    it('does not list tags column in regular segment upsert update set', function() {
        assert.ok(
            !segmentUpdateColumns.includes('tags'),
            'regular segment UPSERT must not overwrite operator tags'
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

    it('subscribes to the durable segments ingest queue by default', function() {
        assert.strictEqual(
            segmentsIngestDestination,
            '/queue/scada.segments.ingest',
            'segment ingest must not use an ephemeral exchange subscription'
        );
    });
});
