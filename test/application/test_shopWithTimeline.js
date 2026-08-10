import assert from 'assert';
import machineOwners from '../../src/infrastructure/messaging/ownership/machineOwners.js';
import shopWithTimeline from '../../src/application/shopWithTimeline.js';

function audit(id) {
    return { id, displayName: `op-${id}`, decidedAt: new Date('2024-08-01T12:00:00.000Z') };
}

function fakePool() {
    return {
        query() {
            return Promise.resolve({ rows: [] });
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
