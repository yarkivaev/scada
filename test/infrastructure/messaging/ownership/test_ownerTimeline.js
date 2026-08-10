import assert from 'assert';
import ownerTimeline from '../../../../src/infrastructure/messaging/ownership/ownerTimeline.js';

function audit(id) {
    return { id, displayName: `op-${id}`, decidedAt: new Date('2024-07-01T08:00:00.000Z') };
}

function fakeLocal() {
    const published = [];
    return {
        published,
        factory(machineId) {
            return {
                async retag(start, tags, properties, row) {
                    published.push({ channel: 'stomp', machineId, start, tags, properties, audit: row });
                },
                async respond(start, tags, properties, row) {
                    published.push({ channel: 'stomp-respond', machineId, start, tags, properties, audit: row });
                }
            };
        }
    };
}

function ownersMap(entries) {
    const map = new Map(Object.entries(entries));
    return {
        resolve(machineId) {
            return map.get(machineId) || Object.freeze({ kind: 'local' });
        }
    };
}

describe('ownerTimeline', function() {
    it('routes local machine retag to local STOMP write only', async function() {
        const localId = `local-μ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const local = fakeLocal();
        const httpCalls = [];
        const write = ownerTimeline(local.factory, ownersMap({
            [`edge-${Math.random()}`]: Object.freeze({
                kind: 'edge',
                baseUrl: 'http://edge.test/api/v1',
                async fetch(url, options) {
                    httpCalls.push({ url, options });
                    return { ok: true, status: 200, async text() {
                        return '';
                    } };
                }
            })
        }));
        const start = new Date('2024-07-01T09:15:00.000Z');
        await write(localId).retag(start, ['heat'], { k: 1 }, audit(9));
        assert.deepStrictEqual(
            { stomp: local.published.length, http: httpCalls.length, machine: local.published[0].machineId },
            { stomp: 1, http: 0, machine: localId },
            'local retag did not stay on STOMP only'
        );
    });

    it('routes edge machine retag to HTTP owner and not local STOMP', async function() {
        const edgeId = `edge-ξ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const local = fakeLocal();
        const httpCalls = [];
        const write = ownerTimeline(local.factory, ownersMap({
            [edgeId]: Object.freeze({
                kind: 'edge',
                baseUrl: 'http://edge.test/api/v1',
                token: 'tok',
                async fetch(url, options) {
                    httpCalls.push({ url, options });
                    return { ok: true, status: 200, async text() {
                        return '';
                    } };
                }
            })
        }));
        const start = new Date('2024-07-01T10:00:00.000Z');
        await write(edgeId).retag(start, ['skim'], {}, audit(2));
        assert.deepStrictEqual(
            {
                stomp: local.published.length,
                http: httpCalls.length,
                method: httpCalls[0].options.method,
                path: httpCalls[0].url
            },
            {
                stomp: 0,
                http: 1,
                method: 'PATCH',
                path: `http://edge.test/api/v1/machines/${encodeURIComponent(edgeId)}/segments`
            },
            'edge retag did not go to HTTP owner only'
        );
    });

    it('surfaces unreachable edge owner as an error', async function() {
        const edgeId = `edge-ο-${Math.floor(Math.random() * 9000 + 1000)}`;
        const local = fakeLocal();
        const write = ownerTimeline(local.factory, ownersMap({
            [edgeId]: Object.freeze({
                kind: 'edge',
                baseUrl: 'http://down.test/api/v1',
                async fetch() {
                    throw new TypeError(`fetch failed for ${edgeId}`);
                }
            })
        }));
        await assert.rejects(
            () => {
                return write(edgeId).retag(new Date(), ['x'], {}, audit(1));
            },
            (err) => {
                return err.routeStatus === 503 && local.published.length === 0;
            },
            'unreachable edge owner did not reject without local STOMP publish'
        );
    });
});
