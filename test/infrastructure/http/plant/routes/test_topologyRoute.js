import assert from 'assert';
import plantApi from '../../../../../src/application/plantApi.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';

function mockRes() {
    return {
        statusCode: 200,
        body: null,
        headersSent: false,
        writeHead(code) {
            this.statusCode = code;
        },
        end(data) {
            this.body = data;
        }
    };
}

function mockReq(url) {
    const listeners = {};
    const req = {
        method: 'GET',
        url,
        headers: {},
        on(event, fn) {
            listeners[event] = fn;
            if (listeners.end) {
                queueMicrotask(() => {
                    listeners.end();
                });
            }
            return req;
        }
    };
    return req;
}

function graph() {
    return {
        plant: { id: 'plant-a', title: 'Plant A', version: '1.0.0' },
        nodes: [
            { id: 'area-1', kind: 'shop', title: 'Area 1' },
            {
                id: 'm1',
                kind: 'machine',
                title: 'M1',
                parent: 'area-1',
                inspect: { host: '127.0.0.1', port: 9222 }
            },
            { id: 'load', kind: 'collector', title: 'Load', parent: 'm1' }
        ],
        links: [
            { from: 'area-1', to: 'm1', kind: 'contains' },
            { from: 'm1', to: 'load', kind: 'contains' }
        ]
    };
}

describe('topologyRoute', function() {
    it('returns the plant topology contract', async function() {
        const expected = graph();
        const item = machine('m1', { sensors: {}, alerts: { all() {
            return [];
        } } });
        const area = shop('area-1', initialized({ m1: item }, Object.values), { all() {
            return [];
        } });
        const p = plantDomain(initialized({ 'area-1': area }, Object.values), { topology() {
            return expected;
        } });
        const api = plantApi('/api/v1', p);
        const res = mockRes();
        await api.handle(mockReq('/api/v1/topology'), res);
        assert.deepStrictEqual(JSON.parse(res.body), expected, 'topology route did not return the plant graph');
    });
});
