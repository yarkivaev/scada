import assert from 'assert';
import httpTimeline from '../../../../src/infrastructure/messaging/ownership/httpTimeline.js';

function audit(id, displayName) {
    return { id, displayName, decidedAt: new Date('2024-06-01T10:00:00.000Z') };
}

describe('httpTimeline', function() {
    it('PATCHes segments with start tags properties and operatorId', async function() {
        const machine = `m-α-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2024-06-01T09:00:00.000Z');
        const calls = [];
        const port = httpTimeline({
            baseUrl: 'http://edge.test/api/v1',
            token: 'sëcret',
            async fetch(url, options) {
                calls.push({ url, options });
                return { ok: true, status: 200, async text() {
                    return '';
                } };
            }
        }, machine);
        await port.retag(start, ['heating', 'skim'], { note: 'yes' }, audit(7, 'Elena'));
        assert.deepStrictEqual(calls[0], {
            url: `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/segments`,
            options: {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sëcret' },
                body: JSON.stringify({
                    start: start.toISOString(),
                    tags: ['heating', 'skim'],
                    properties: { note: 'yes' },
                    operatorId: 7
                })
            }
        }, 'httpTimeline did not PATCH owner segments with audit');
    });

    it('POSTs respond to owner request path', async function() {
        const machine = `m-β-${Math.floor(Math.random() * 9000 + 1000)}`;
        const start = new Date('2024-06-02T11:00:00.000Z');
        const calls = [];
        const port = httpTimeline({
            baseUrl: 'http://edge.test/api/v1/',
            async fetch(url, options) {
                calls.push({ url, options });
                return { ok: true, status: 200, async text() {
                    return '';
                } };
            }
        }, machine);
        await port.respond(start, ['idle'], {}, audit(3, 'Ivan'));
        assert.strictEqual(
            calls[0].url,
            `http://edge.test/api/v1/machines/${encodeURIComponent(machine)}/requests/${encodeURIComponent(start.toISOString())}/respond`,
            'httpTimeline did not POST respond to owner request path'
        );
    });

    it('throws SERVICE_UNAVAILABLE when owner fetch rejects', async function() {
        const machine = `m-γ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const port = httpTimeline({
            baseUrl: 'http://down.test/api/v1',
            async fetch() {
                throw new Error('ECONNREFUSED');
            }
        }, machine);
        await assert.rejects(
            () => {
                return port.retag(new Date(), ['x'], {}, audit(1, 'op'));
            },
            (err) => {
                return err.routeCode === 'SERVICE_UNAVAILABLE' && err.routeStatus === 503;
            },
            'unreachable owner did not fail with SERVICE_UNAVAILABLE'
        );
    });

    it('throws BAD_GATEWAY when owner returns non-ok status', async function() {
        const machine = `m-δ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const port = httpTimeline({
            baseUrl: 'http://edge.test/api/v1',
            async fetch() {
                return { ok: false, status: 502, async text() {
                    return 'bad gateway';
                } };
            }
        }, machine);
        await assert.rejects(
            () => {
                return port.retag(new Date(), ['x'], {}, audit(1, 'op'));
            },
            (err) => {
                return err.routeCode === 'BAD_GATEWAY' && err.routeStatus === 502;
            },
            'non-ok owner response did not fail with BAD_GATEWAY'
        );
    });
});
