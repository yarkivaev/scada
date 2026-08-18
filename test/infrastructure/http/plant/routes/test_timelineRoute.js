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

function buildScene(requireOperator) {
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
            return [];
        },
        pending: async () => {
            return [];
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
        }
    });
    return { api, machineId, captured };
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
