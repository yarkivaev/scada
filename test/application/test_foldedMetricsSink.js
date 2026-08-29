import assert from 'assert';
import foldedMetricsSink from '../../src/application/foldedMetricsSink.js';

describe('foldedMetricsSink', function() {
    it('folds an opcua sample after writing the point', async function() {
        const written = [];
        const queries = [];
        const device = `tlc-${Math.random().toString(36).slice(2, 6)}`;
        const key = `ladle_${Math.random().toString(36).slice(2, 8)}`;
        const sink = foldedMetricsSink(
            {
                write(rows) {
                    written.push(...rows);
                    return Promise.resolve();
                }
            },
            {
                async query(sql, params) {
                    queries.push({ sql, params });
                    return { rows: [] };
                }
            },
            { [device]: 'cm8' }
        );
        await sink.write([{
            topic: `OPCUA/${device}/GET/${key}/VALUE`,
            value: 1,
            ts: Date.now()
        }]);
        assert.strictEqual(written.length, 1, 'inner sink missed the telemetry point');
        assert.ok(
            queries.some((row) => {
                return String(row.sql).includes('INSERT INTO segments');
            }),
            'opcua point was not folded into a segment'
        );
    });

    it('leaves the inner sink alone when no devices are mapped', function() {
        const inner = { write() { return Promise.resolve(); } };
        const sink = foldedMetricsSink(inner, {}, {});
        assert.strictEqual(sink, inner, 'empty devices still wrapped the metrics sink');
    });
});
