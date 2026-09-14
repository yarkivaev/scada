import assert from 'assert';
import topologyFromPlant from '../../src/application/topologyFromPlant.js';
import plant from '../../src/domain/plant/plant.js';
import shop from '../../src/domain/plant/shop.js';
import machine from '../../src/domain/plant/machine.js';
import initialized from '../../src/domain/shared/initialized.js';

function silentSensor(key) {
    return {
        name() {
            return key;
        },
        async current() {
            return { found: false };
        }
    };
}

function walkedPlant(sensorKey) {
    const item = machine('m1', { sensors: { [sensorKey]: silentSensor(sensorKey) }, alerts: { all() {
        return [];
    } } });
    const area = shop('area-1', initialized({ m1: item }, Object.values), { all() {
        return [];
    } });
    return plant(initialized({ 'area-1': area }, Object.values));
}

describe('topologyFromPlant', function() {
    it('walks shops machines and sensors when topology is absent', function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const graph = topologyFromPlant(walkedPlant(key));
        assert.deepStrictEqual(
            graph.nodes.map((node) => {
                return { id: node.id, kind: node.kind, parent: node.parent };
            }),
            [
                { id: 'area-1', kind: 'shop', parent: undefined },
                { id: 'm1', kind: 'machine', parent: 'area-1' },
                { id: `m1-${key}`, kind: 'collector', parent: 'm1' }
            ],
            'walk did not emit shop machine and collector nodes'
        );
    });

    it('prefers an explicit topology function over walking sensors', function() {
        const graph = {
            plant: { id: 'plant-a', title: 'Plant A', version: '1.0.0' },
            nodes: [
                { id: 'area-1', kind: 'shop', title: 'Area 1' },
                { id: 'm1', kind: 'machine', title: 'M1', parent: 'area-1', inspect: { host: '127.0.0.1', port: 9222 } },
                { id: 'load', kind: 'collector', title: 'Load', parent: 'm1' }
            ],
            links: [
                { from: 'area-1', to: 'm1', kind: 'contains' },
                { from: 'm1', to: 'load', kind: 'contains' }
            ]
        };
        const p = plant(initialized({}, Object.values), { topology() {
            return graph;
        } });
        assert.strictEqual(
            topologyFromPlant(p).nodes.find((node) => {
                return node.id === 'm1';
            }).inspect.port,
            9222,
            'explicit topology did not win over the shop walk'
        );
    });

    it('rejects an explicit topology that omits nodes', function() {
        const p = plant(initialized({}, Object.values), { topology() {
            return { plant: { id: 'plant-a', title: 'Plant A' }, links: [] };
        } });
        assert.throws(() => {
            topologyFromPlant(p);
        }, 'invalid topology was silently repaired');
    });
});
