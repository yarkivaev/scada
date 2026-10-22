import assert from 'node:assert';
import coverageCursor from '../../../src/application/mcp/coverageCursor.js';
import coverageSpans from '../../../src/domain/span/coverageSpans.js';

describe('coverageCursor', function() {
    it('uses the latest sample as the bound when ingest_checkpoints are empty', async function() {
        const from = '2024-11-02T03:04:05.137Z';
        const sample = '2024-11-02T03:05:05.137Z';
        const to = '2024-11-02T03:06:05.137Z';
        const path = `площадка/ихт-α/${Math.floor(Math.random() * 9000 + 1000)}`;
        const pool = {
            async query() {
                return { rows: [] };
            }
        };
        const bound = await coverageCursor(pool, () => {
            return [{ ts: sample }];
        })({ path });
        const spans = coverageSpans([sample], from, to, 60000, bound);
        assert.deepStrictEqual(spans.map((span) => {
            return span.status;
        }), ['present', 'unknown'], 'empty checkpoints painted the sampled window unknown');
    });
});
