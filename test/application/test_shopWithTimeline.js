import assert from 'assert';
import machineOwners from '../../src/infrastructure/messaging/ownership/machineOwners.js';
import shopWithTimeline from '../../src/application/shopWithTimeline.js';

function audit(id) {
    return { id, displayName: `op-${id}`, decidedAt: new Date('2024-08-01T12:00:00.000Z') };
}

function fakePool(start) {
    const at = start || new Date('2024-08-01T11:00:00.000Z');
    return {
        async query(sql) {
            if (String(sql).includes('UPDATE')) {
                return { rowCount: 1, rows: [] };
            }
            return {
                rows: [{
                    name: 'off',
                    start_time: at,
                    end_time: new Date(at.getTime() + 300000),
                    duration: 300,
                    options: '[]',
                    tags: '["heat"]',
                    properties: '{}'
                }]
            };
        }
    };
}

function emptyPool() {
    return {
        async query() {
            return { rowCount: 0, rows: [] };
        }
    };
}

describe('shopWithTimeline owners', function() {
    it('retags local machine via userDecisions when owners omit it', async function() {
        const machine = `local-ψ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const published = [];
        const decisions = {
            async publish(id, start, tags, properties, row) {
                published.push({ id, start, tags, properties, audit: row });
            }
        };
        const httpCalls = [];
        const owners = {
            resolve(machineId) {
                if (machineId === machine) {
                    return Object.freeze({ kind: 'local' });
                }
                return Object.freeze({
                    kind: 'edge',
                    baseUrl: 'http://edge.test/api/v1',
                    async fetch(url, options) {
                        httpCalls.push({ url, options });
                        return { ok: true, status: 200, async text() {
                            return '';
                        } };
                    }
                });
            }
        };
        const tl = shopWithTimeline(machine, { pool: fakePool(), userDecisions: decisions, owners });
        const start = new Date('2024-08-01T11:00:00.000Z');
        await tl.retag(start, ['heat'], {}, audit(4));
        assert.deepStrictEqual(
            { stomp: published.length, http: httpCalls.length, id: published[0].id },
            { stomp: 1, http: 0, id: machine },
            'shopWithTimeline did not retag local machine via STOMP only'
        );
    });

    it('retags edge machine via HTTP owner from EDGE_SITES-shaped registry', async function() {
        const machine = `edge-ω-${Math.floor(Math.random() * 9000 + 1000)}`;
        const published = [];
        const decisions = {
            async publish(id, start, tags, properties, row) {
                published.push({ id, start, tags, properties, audit: row });
            }
        };
        const httpCalls = [];
        const sites = [{
            baseUrl: 'http://edge.example:30300/api/v1',
            token: 'edge-tøkën',
            machines: [machine]
        }];
        const base = machineOwners(sites);
        const owners = {
            resolve(machineId) {
                const owner = base.resolve(machineId);
                if (owner.kind !== 'edge') {
                    return owner;
                }
                return Object.freeze({
                    ...owner,
                    async fetch(url, options) {
                        httpCalls.push({ url, options });
                        return { ok: true, status: 200, async text() {
                            return '';
                        } };
                    }
                });
            }
        };
        const tl = shopWithTimeline(machine, { pool: fakePool(), userDecisions: decisions, owners });
        const start = new Date('2024-08-01T11:30:00.000Z');
        await tl.retag(start, ['skim'], { note: 'yes' }, audit(8));
        assert.deepStrictEqual(
            {
                stomp: published.length,
                http: httpCalls.length,
                method: httpCalls[0].options.method,
                auth: httpCalls[0].options.headers.Authorization
            },
            {
                stomp: 0,
                http: 1,
                method: 'PATCH',
                auth: 'Bearer edge-tøkën'
            },
            'shopWithTimeline did not retag edge machine via HTTP owner only'
        );
    });
});

describe('shopWithTimeline postgres confirm', function() {
    it('writes tags to segments before publishing the decision', async function() {
        const machine = `ихт-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-08-20T12:29:24.318Z');
        const tag = `возврат-${Math.floor(Math.random() * 90)}`;
        const updates = [];
        const pool = {
            async query(sql, params) {
                if (String(sql).includes('UPDATE')) {
                    updates.push(params[0]);
                    return { rowCount: 1, rows: [] };
                }
                return fakePool(start).query(sql, params);
            }
        };
        const decisions = { async publish() {} };
        const tl = shopWithTimeline(machine, { pool, userDecisions: decisions });
        await tl.retag(start, [tag], {}, audit(90));
        assert.strictEqual(updates[0], JSON.stringify([tag]), 'retag did not UPDATE segments.tags before success');
    });

    it('publishes a retag envelope to the segments broker', async function() {
        const machine = `ихт-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2026-08-20T09:10:22.885Z');
        const published = [];
        const decisions = { async publish() {} };
        const segments = {
            async publish(body) {
                published.push(body);
            }
        };
        const tl = shopWithTimeline(machine, {
            pool: fakePool(start),
            userDecisions: decisions,
            segments
        });
        await tl.retag(start, ['return_pouring'], {}, audit(90));
        assert.strictEqual(published[0].type, 'retag', 'successful retag did not publish type retag');
    });

    it('does not publish a decision when the segment row is missing', async function() {
        const machine = `ихт-${Math.floor(Math.random() * 9000 + 1000)}`;
        const published = [];
        const decisions = {
            async publish() {
                published.push(1);
            }
        };
        const tl = shopWithTimeline(machine, { pool: emptyPool(), userDecisions: decisions });
        let failed = false;
        try {
            await tl.retag(new Date('2026-08-20T11:03:59.381Z'), ['to_ladle'], {}, audit(90));
        } catch {
            failed = true;
        }
        assert.deepStrictEqual(
            { failed, published: published.length },
            { failed: true, published: 0 },
            'missing segment still published a user decision'
        );
    });
});
