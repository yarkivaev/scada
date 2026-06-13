import assert from 'assert';
import { virtualClock } from '@yarkivaev/simple-server';
import plant from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import shop from '../../../../../src/domain/plant/shop.js';
import machine from '../../../../../src/domain/plant/machine.js';
import { alert, acknowledgedAlert, alerts } from '../../../../../index.js';
import plantApi from '../../../../../src/application/plantApi.js';
import plantOperations from '../../../../../src/application/plantOperations.js';
import stateDataFake from '../../../../helpers/stateDataFake.js';

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

function buildPlant(data, machineId) {
    const wrapped = plantOperations(data.operations);
    const history = alerts(alert, acknowledgedAlert);
    const item = machine(machineId, {
        sensors: {},
        alerts: history,
        timeline: {
            list: async () => {
                return [];
            },
            pending: async () => {
                return [];
            },
            stream: () => {
                return { cancel() {} };
            }
        }
    });
    const area = shop('area', initialized({ [machineId]: item }, Object.values), history);
    return {
        plant: plant(initialized({ area }, Object.values), { operations: wrapped }),
        wrapped
    };
}

describe('operationRoute', function() {
    it('returns empty items when machine is absent', async function() {
        const data = stateDataFake({});
        const { plant: p } = buildPlant(data, `missing-${Math.random()}`);
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            })
        });
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/unknown-${Math.random()}/operations?kind=chem`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.items.length, 0, 'unknown machine must return empty list');
    });

    it('returns only rows matching kind and occurred_at window', async function() {
        const machineId = `icht${Math.floor(Math.random() * 9000 + 1000)}`;
        const data = stateDataFake({});
        const { plant: p, wrapped } = buildPlant(data, machineId);
        const key = `op-${Math.random()}`;
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T12:00:00.000Z'),
            kind: 'chem',
            key,
            payload: { lot: 'α' }
        });
        await wrapped.upsert({
            machine: machineId,
            occurred_at: new Date('2024-06-01T13:00:00.000Z'),
            kind: 'qc',
            key: `qc-${Math.random()}`,
            payload: {}
        });
        const api = plantApi('/api/v1', p, {
            clock: virtualClock(() => {
                return new Date();
            })
        });
        const res = mockRes();
        await api.handle({
            method: 'GET',
            url: `/api/v1/machines/${machineId}/operations?kind=chem&from=2024-06-01T00:00:00.000Z&to=2024-06-02T00:00:00.000Z`,
            headers: {}
        }, res);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.items.length, 1, 'kind filter must exclude other kinds');
    });
});
