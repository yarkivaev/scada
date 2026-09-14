import assert from 'assert';
import topologyHealth from '../../src/application/topologyHealth.js';
import plant from '../../src/domain/plant/plant.js';
import shop from '../../src/domain/plant/shop.js';
import machine from '../../src/domain/plant/machine.js';
import initialized from '../../src/domain/shared/initialized.js';

function sensor(reading) {
    return {
        async current() {
            return reading;
        }
    };
}

function site(sensorKey, reading) {
    const item = machine('m1', { sensors: { [sensorKey]: sensor(reading) }, alerts: { all() {
        return [];
    } } });
    const area = shop('area-1', initialized({ m1: item }, Object.values), { all() {
        return [];
    } });
    return plant(initialized({ 'area-1': area }, Object.values));
}

function graph(sensorKey) {
    return {
        plant: { id: 'plant-a', title: 'Plant A' },
        nodes: [
            { id: 'area-1', kind: 'shop', title: 'Area 1', status: 'unknown' },
            { id: 'm1', kind: 'machine', title: 'M1', parent: 'area-1', status: 'unknown' },
            { id: `m1-${sensorKey}`, kind: 'collector', title: sensorKey, parent: 'm1', status: 'unknown' },
            { id: 'orphan', kind: 'collector', title: 'Orphan', status: 'unknown' }
        ],
        links: []
    };
}

describe('topologyHealth', function() {
    it('marks a collector ok when current() is fresh', async function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const now = new Date('2026-09-14T12:00:00.000Z');
        const painted = await topologyHealth(
            graph(key),
            site(key, { found: true, timestamp: new Date('2026-09-14T11:59:00.000Z') }),
            () => {
                return now;
            }
        );
        assert.strictEqual(
            painted.nodes.find((node) => {
                return node.id === `m1-${key}`;
            }).status,
            'ok',
            'fresh current() did not mark the collector ok'
        );
    });

    it('marks a collector down when current() is missing', async function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const painted = await topologyHealth(
            graph(key),
            site(key, { found: false }),
            () => {
                return new Date('2026-09-14T12:00:00.000Z');
            }
        );
        assert.strictEqual(
            painted.nodes.find((node) => {
                return node.id === `m1-${key}`;
            }).status,
            'down',
            'missing current() did not mark the collector down'
        );
    });

    it('leaves unmatched nodes unknown', async function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const painted = await topologyHealth(
            graph(key),
            site(key, { found: true, timestamp: new Date('2026-09-14T11:59:00.000Z') }),
            () => {
                return new Date('2026-09-14T12:00:00.000Z');
            }
        );
        assert.strictEqual(
            painted.nodes.find((node) => {
                return node.id === 'orphan';
            }).status,
            'unknown',
            'unmatched collector was painted from another sensor'
        );
    });

    it('paints a grouped collector from its machine status', async function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const layout = graph(key);
        layout.nodes.push({
            id: 'm1-mx210',
            kind: 'collector',
            title: 'mx210',
            parent: 'm1',
            status: 'unknown'
        });
        const painted = await topologyHealth(
            layout,
            site(key, { found: true, timestamp: new Date('2026-09-14T11:59:00.000Z') }),
            () => {
                return new Date('2026-09-14T12:00:00.000Z');
            }
        );
        assert.strictEqual(
            painted.nodes.find((node) => {
                return node.id === 'm1-mx210';
            }).status,
            'ok',
            'grouped collector did not inherit the machine status'
        );
    });

    it('paints a shop collector from its shop status', async function() {
        const key = `load-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const id = `bay-\u041d${Math.floor(Math.random() * 90 + 10)}`;
        const layout = graph(key);
        layout.nodes.push({
            id,
            kind: 'collector',
            title: id,
            parent: 'area-1',
            status: 'unknown'
        });
        const painted = await topologyHealth(
            layout,
            site(key, { found: true, timestamp: new Date('2026-09-14T11:59:00.000Z') }),
            () => {
                return new Date('2026-09-14T12:00:00.000Z');
            }
        );
        assert.strictEqual(
            painted.nodes.find((node) => {
                return node.id === id;
            }).status,
            'ok',
            'shop collector did not inherit the shop status'
        );
    });
});

