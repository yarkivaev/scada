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

function mockReq(bodyText, meta) {
    const listeners = {};
    const req = {
        method: meta.method,
        url: meta.url,
        headers: meta.headers || {},
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

function buildScene(requireOperator, extras) {
    const extra = extras || {};
    const machineId = `m${Math.floor(Math.random() * 9000 + 1000)}`;
    const uid = `route-${Math.random()}`;
    const captured = [];
    const provider = {
        async list() {
            return [operator(3, uid, 'Elena', 'Volkov', 'Elena Volkov')];
        }
    };
    const history = alerts(alert, acknowledgedAlert);
    const timeline = {
        list: async () => {
            return extra.listed || [];
        },
        pending: async () => {
            return extra.waiting || [];
        },
        stream: () => {
            return { cancel() {} };
        },
        async rowAt(start) {
            return captured.row
                ? { ...captured.row, start_time: start }
                : null;
        },
        async retag(start, tags, properties, audit) {
            captured.push({ start, tags, properties, audit });
        },
        async respond(requestId, body, audit) {
            captured.push({ requestId, body, audit });
            return { id: requestId, ...body };
        }
    };
    const item = machine(machineId, { sensors: {}, alerts: history, timeline });
    const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
    const p = plantDomain(initialized({ area }, Object.values));
    const api = plantApi('/api/v1', p, {
        clock: virtualClock(() => {
            return new Date();
        }),
        timelineOperator: {
            provider,
            requireOperator,
            defaultUser: 'hmi-kiosk'
        },
        decorateTimeline: extra.decorate
    });
    return { api, machineId, captured };
}

function staleOff(start) {
    const begin = start || new Date();
    return {
        name: 'off',
        start_time: begin,
        end_time: new Date(begin.getTime() + 60000),
        duration: 60,
        options: ['repair'],
        tags: []
    };
}

function paintEmergency(_id, rows) {
    return rows.map((row) => {
        return { ...row, options: ['repair_emergency'] };
    });
}

describe('timelineRoute operator audit', function() {
    it('returns 403 when requireOperator is true and operatorId is missing on PATCH', async function() {
        const scene = buildScene(true);
        const res = mockRes();
        const start = new Date().toISOString();
        await scene.api.handle(
            mockReq(JSON.stringify({ start, tags: ['heat'], properties: {} }), {
                method: 'PATCH',
                url: `/api/v1/machines/${scene.machineId}/segments`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 403, 'timeline route did not reject missing operator when required');
    });

    it('resolves displayName from operator cache on PATCH segments', async function() {
        const scene = buildScene(true);
        const res = mockRes();
        const start = new Date().toISOString();
        await scene.api.handle(
            mockReq(JSON.stringify({ start, tags: ['heat'], properties: {}, operatorId: 3 }), {
                method: 'PATCH',
                url: `/api/v1/machines/${scene.machineId}/segments`
            }),
            res
        );
        assert.strictEqual(scene.captured[0].audit.displayName, 'Elena Volkov', 'timeline route did not resolve operator display name');
    });

    it('returns 400 when PATCH tags are outside published options', async function() {
        const scene = buildScene(true);
        scene.captured.row = {
            name: 'off',
            options: ['load'],
            tags: []
        };
        const res = mockRes();
        const start = new Date().toISOString();
        await scene.api.handle(
            mockReq(JSON.stringify({ start, tags: ['pour'], properties: {}, operatorId: 3 }), {
                method: 'PATCH',
                url: `/api/v1/machines/${scene.machineId}/segments`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400, 'timeline route accepted a tag outside options');
    });
});

describe('timelineRoute decorateTimeline', function() {
    it('returns decorated options on GET segments', async function() {
        const scene = buildScene(false, { listed: [staleOff()], decorate: paintEmergency });
        const res = mockRes();
        await scene.api.handle(
            mockReq('', { method: 'GET', url: `/api/v1/machines/${scene.machineId}/segments` }),
            res
        );
        assert.deepStrictEqual(
            JSON.parse(res.body).items[0].options,
            ['repair_emergency'],
            'GET segments kept stored options'
        );
    });

    it('returns decorated options on GET pending requests', async function() {
        const begin = new Date();
        const scene = buildScene(false, {
            waiting: [{ id: `req-${Math.random()}`, ...staleOff(begin) }],
            decorate: paintEmergency
        });
        const res = mockRes();
        await scene.api.handle(
            mockReq('', { method: 'GET', url: `/api/v1/machines/${scene.machineId}/requests` }),
            res
        );
        assert.deepStrictEqual(
            JSON.parse(res.body).items[0].options,
            ['repair_emergency'],
            'GET requests kept stored options'
        );
    });

    it('accepts a PATCH tag that decorate publishes over stale stored options', async function() {
        const scene = buildScene(true, { decorate: paintEmergency });
        scene.captured.row = staleOff();
        const res = mockRes();
        const start = new Date().toISOString();
        await scene.api.handle(
            mockReq(JSON.stringify({ start, tags: ['repair_emergency'], properties: {}, operatorId: 3 }), {
                method: 'PATCH',
                url: `/api/v1/machines/${scene.machineId}/segments`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 200, 'PATCH rejected a tag that decorate allowed');
    });

    it('rejects a PATCH tag that decorate dropped even when stored options are empty', async function() {
        const scene = buildScene(true, { decorate: paintEmergency });
        scene.captured.row = { name: 'off', options: null, tags: [] };
        const res = mockRes();
        const start = new Date().toISOString();
        await scene.api.handle(
            mockReq(JSON.stringify({ start, tags: ['to_ladle'], properties: {}, operatorId: 3 }), {
                method: 'PATCH',
                url: `/api/v1/machines/${scene.machineId}/segments`
            }),
            res
        );
        assert.strictEqual(res.statusCode, 400, 'PATCH accepted a tag decorate did not publish');
    });
});
