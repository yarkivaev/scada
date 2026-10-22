import assert from 'assert';
import { virtualClock } from '@yarkivaev/simple-server';
import operator from '../../../../../src/domain/operator/operator.js';
import plantApi from '../../../../../src/application/plantApi.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';
import { alert, acknowledgedAlert, alerts } from '../../../../../index.js';

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        }
    };
}

function mockReq(bodyText) {
    const listeners = {};
    const req = {
        method: 'PATCH',
        url: '',
        headers: {},
        on(event, fn) {
            listeners[event] = fn;
            if (listeners.end) {
                queueMicrotask(() => {
                    if (listeners.data) {
                        listeners.data(Buffer.from(bodyText));
                    }
                    listeners.end();
                });
            }
            return req;
        }
    };
    return req;
}

function buildScene(decorateTimeline) {
    const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
    const captured = [];
    const provider = {
        async list() {
            return [operator(3, `route-${Math.random()}`, 'Elena', 'Volkov', 'Elena Volkov')];
        }
    };
    const history = alerts(alert, acknowledgedAlert);
    const timeline = {
        async list() {
            return [];
        },
        async pending() {
            return [];
        },
        stream() {
            return { cancel() {} };
        },
        async rowAt(start) {
            return captured.row ? { ...captured.row, start_time: start } : null;
        },
        async retag(start, tags, properties, audit) {
            captured.push({ kind: 'retag', start, tags, properties, audit });
        },
        async respond(requestId, body, audit) {
            captured.push({ kind: 'respond', requestId, body, audit });
            return { id: requestId, ...body };
        }
    };
    const item = machine(machineId, { sensors: {}, alerts: history, timeline });
    const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
    const api = plantApi('/api/v1', plantDomain(initialized({ area }, Object.values)), {
        clock: virtualClock(() => {
            return new Date();
        }),
        timelineOperator: { provider, requireOperator: true, defaultUser: 'hmi-kiosk' },
        decorateTimeline
    });
    return { api, machineId, captured };
}

function patch(scene, body) {
    const res = mockRes();
    const req = mockReq(JSON.stringify(body));
    req.url = `/api/v1/machines/${scene.machineId}/segments`;
    return scene.api.handle(req, res).then(() => {
        return res;
    });
}

describe('timeline PATCH splits', function() {
    it('responds to a split instead of retagging one row', async function() {
        const scene = buildScene();
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        scene.captured.row = { name: 'off', options: ['шлак', 'шихта'], tags: [] };
        await patch(scene, {
            start: start.toISOString(),
            operatorId: 3,
            splits: [
                { start, end: cut, tag: '' },
                { start: cut, end, tag: 'шлак' }
            ]
        });
        assert.deepStrictEqual(scene.captured.map((row) => {
            return row.kind;
        }), ['respond'], 'PATCH splits retagged one row instead of responding');
    });

    it('allows an empty split tag when another piece is tagged', async function() {
        const scene = buildScene();
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        scene.captured.row = { name: 'off', options: ['шлак', 'шихта'], tags: [] };
        const res = await patch(scene, {
            start: start.toISOString(),
            operatorId: 3,
            splits: [
                { start, end: cut, tag: '' },
                { start: cut, end, tag: 'шлак' }
            ]
        });
        assert.strictEqual(res.statusCode, 200, 'PATCH rejected an empty split tag while another piece was tagged');
    });

    it('rejects a split tag that is outside the published options', async function() {
        const scene = buildScene();
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        scene.captured.row = { name: 'off', options: ['шлак'], tags: [] };
        const res = await patch(scene, {
            start: start.toISOString(),
            operatorId: 3,
            splits: [
                { start, end: cut, tag: '' },
                { start: cut, end, tag: 'pour' }
            ]
        });
        assert.strictEqual(res.statusCode, 400, 'PATCH accepted a split tag outside options');
    });

    it('accepts charge loading on the next piece after lining inspection', async function() {
        const scene = buildScene(function (_machineId, rows) {
            return rows.map(function (row, index) {
                const prior = rows.slice(0, index).some(function (earlier) {
                    return Array.isArray(earlier.tags) && earlier.tags.includes('lining_inspection');
                });
                const options = prior ? ['charge_loading', 'lining_inspection'] : ['lining_inspection'];
                return { ...row, options };
            });
        });
        const start = new Date('2026-10-22T08:11:07.413Z');
        const cut = new Date(start.getTime() + 17000);
        const end = new Date(start.getTime() + 64000);
        scene.captured.row = { name: 'off', options: ['lining_inspection'], tags: [] };
        const res = await patch(scene, {
            start: start.toISOString(),
            operatorId: 3,
            splits: [
                { start, end: cut, tag: 'lining_inspection' },
                { start: cut, end, tag: 'charge_loading' }
            ]
        });
        assert.strictEqual(res.statusCode, 200, 'PATCH rejected charge loading after lining inspection in the same split');
    });

    it('rejects charge loading when no earlier piece entered melting', async function() {
        const scene = buildScene(function (_machineId, rows) {
            return rows.map(function (row, index) {
                const prior = rows.slice(0, index).some(function (earlier) {
                    return Array.isArray(earlier.tags) && earlier.tags.includes('lining_inspection');
                });
                const options = prior ? ['charge_loading', 'lining_inspection'] : ['lining_inspection'];
                return { ...row, options };
            });
        });
        const start = new Date('2026-10-22T09:04:41.907Z');
        const cut = new Date(start.getTime() + 23000);
        const end = new Date(start.getTime() + 81000);
        scene.captured.row = { name: 'off', options: ['lining_inspection'], tags: [] };
        const res = await patch(scene, {
            start: start.toISOString(),
            operatorId: 3,
            splits: [
                { start, end: cut, tag: '' },
                { start: cut, end, tag: 'charge_loading' }
            ]
        });
        assert.strictEqual(res.statusCode, 400, 'PATCH accepted charge loading before lining inspection');
    });
});
