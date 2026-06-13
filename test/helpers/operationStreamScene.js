import { virtualClock } from '@yarkivaev/simple-server';
import {
    alert,
    acknowledgedAlert,
    alerts,
    initialized,
    machine,
    plant,
    shop
} from '../../index.js';
import plantApi from '../../src/application/plantApi.js';
import plantOperations from '../../src/application/plantOperations.js';
import stateDataFake from './stateDataFake.js';

function sseCapture() {
    const chunks = [];
    const res = {
        writeHead() {},
        write(content) {
            chunks.push(content);
        },
        end() {}
    };
    const req = {
        on() {
            return req;
        }
    };
    return {
        req,
        res,
        text() {
            return chunks.join('');
        }
    };
}

/**
 * Composes plant API wiring with operations upsert after SSE stream opens.
 *
 * @returns {object} scene with afterUpsert method
 *
 * @example
 *   const text = await operationStreamScene().afterUpsert();
 */
export default function operationStreamScene() {
    const machineId = `icht${Math.floor(Math.random() * 9000 + 1000)}`;
    const data = stateDataFake({});
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
    const area = shop('meltingShop', initialized({ [machineId]: item }, Object.values), history);
    const p = plant(initialized({ meltingShop: area }, Object.values), { operations: wrapped });
    const clock = virtualClock(function clockSource() {
        return new Date();
    });
    const api = plantApi('/api/v1', p, { clock, heartbeat: 1000 });
    return {
        async afterUpsert() {
            const capture = sseCapture();
            await api.handle({
                method: 'GET',
                url: '/api/v1/operations/stream',
                headers: {}
            }, capture.res);
            await wrapped.upsert({
                machine: machineId,
                occurred_at: new Date(Date.now() + Math.floor(Math.random() * 1e6)),
                kind: 'chem',
                key: `stream-${Math.random()}`,
                payload: { note: 'ж' }
            });
            await new Promise((resolve) => {
                setImmediate(resolve);
            });
            return capture.text();
        }
    };
}
