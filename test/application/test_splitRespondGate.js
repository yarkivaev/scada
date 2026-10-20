import assert from 'assert';
import shopWithTimeline from '../../src/application/shopWithTimeline.js';

function audit(id) {
    return { id, displayName: `op-${id}`, decidedAt: new Date('2026-10-19T08:00:00.137Z') };
}

describe('shopWithTimeline split gate', function() {
    it('publishes a split whose closed piece is shorter than 60 seconds', async function() {
        const machine = `ичт-${Math.floor(Math.random() * 8000 + 1000)}`;
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 30000);
        const end = new Date(start.getTime() + 240000);
        let published = 0;
        const client = {
            query() {
                return Promise.resolve({});
            },
            release() {}
        };
        const pool = {
            connect() {
                return Promise.resolve(client);
            },
            async query(text) {
                if (String(text).includes('SELECT')) {
                    return { rows: [{ name: 'off', start_time: start, end_time: end, duration: 240 }] };
                }
                return { rows: [], rowCount: 0 };
            }
        };
        const tl = shopWithTimeline(machine, {
            pool,
            userDecisions: {
                async publishSplit() {
                    published += 1;
                }
            }
        });
        let failed = false;
        try {
            await tl.respond(start.toISOString(), {
                splits: [
                    { start, end: cut, tag: 'шлак' },
                    { start: cut, end, tag: 'шихта' }
                ]
            }, audit(11));
        } catch (error) {
            failed = error instanceof RangeError;
        }
        assert.deepStrictEqual(
            { failed, published },
            { failed: false, published: 1 },
            'a short split was not published to the supervisor'
        );
    });
});
