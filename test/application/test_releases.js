import assert from 'node:assert';
import releases from '../../src/application/deploy/releases.js';

describe('releases', function() {
    it('gives the receiver the objects an upstream node sends', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const url = `http://192.0.2.${Math.floor(Math.random() * 200) + 1}:30300/api/v1`;
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1', secret: 'pg' } },
            machines: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
            nodes: [
                {
                    api: [{ id: 'plant', url }],
                    id: 'cell',
                    implementation: { cluster: 'cell', profile: 'cell' },
                    fan_in: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
                    upstream: [{ objects: [machine], to: 'archive' }]
                },
                {
                    id: 'archive',
                    implementation: { cluster: 'archive', profile: 'archive' }
                }
            ],
            profiles: {
                archive: { modules: { telemetry_store: { enabled: true } } },
                cell: { modules: { state_store: { enabled: true } } }
            }
        }, 'archive');
        assert.deepStrictEqual(
            cut.scada.sites,
            [{ baseUrl: url, machines: [machine] }],
            'releases dropped the upstream route on the receiver'
        );
    });

    it('keeps upstream off the sender release', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1' } },
            machines: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
            nodes: [
                {
                    api: [{ id: 'plant', url: 'http://192.0.2.9:30300/api/v1' }],
                    id: 'cell',
                    implementation: { cluster: 'cell', profile: 'cell' },
                    fan_in: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
                    upstream: [{ objects: [machine], to: 'archive' }]
                },
                { id: 'archive', implementation: { cluster: 'archive', profile: 'archive' } }
            ],
            profiles: { archive: { modules: {} }, cell: { modules: {} } }
        }, 'cell');
        assert.strictEqual(cut.scada.sites, undefined, 'releases copied upstream onto the sender');
    });

    it('publishes telemetry and leaves editable state out of it', function() {
        const meter = `m${Math.random().toString(36).slice(2, 8)}`;
        const state = `s${Math.random().toString(36).slice(2, 8)}`;
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1' } },
            nodes: [{
                fan_in: [{ device: 'd', id: meter, kind: 'unit', place: 'mill.hall' }],
                id: 'cell',
                implementation: { cluster: 'cell', profile: 'cell' },
                ownership: [{ id: state, kind: 'cycle' }]
            }],
            profiles: { cell: { modules: {} } }
        }, 'cell');
        assert.deepStrictEqual(
            cut.scada.machines.map((item) => {return item.id}),
            [meter],
            'releases published editable state as telemetry'
        );
    });

    it('installs the telemetry store only when that module is enabled', function() {
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1' } },
            machines: [],
            nodes: [{ id: 'archive', implementation: { cluster: 'archive', profile: 'archive' } }],
            profiles: { archive: { modules: { telemetry_store: { enabled: true } } } }
        }, 'archive');
        assert.strictEqual(
            cut.scada.clickhouse.enabled,
            true,
            'releases left the telemetry store disabled'
        );
    });

    it('passes an app only to the clusters it names', function() {
        const name = `book${Math.random().toString(36).slice(2, 6)}`;
        const cut = releases({
            apps: {
                scada: { image: 'example.invalid/plant:1' },
                [name]: { chart: 'wms', clusters: ['archive'], values: { image: 'example.invalid/wms:1' } }
            },
            machines: [],
            nodes: [
                { id: 'cell', implementation: { cluster: 'cell', profile: 'cell' } },
                { id: 'archive', implementation: { cluster: 'archive', profile: 'archive' } }
            ],
            profiles: { archive: { modules: {} }, cell: { modules: {} } }
        }, 'cell');
        assert.deepStrictEqual(cut.apps, [], 'releases delivered an app to a cluster it does not name');
    });

    it('rejects an edge whose two sides list different objects', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const other = `n${Math.random().toString(36).slice(2, 8)}`;
        const url = 'http://192.0.2.14:30300/api/v1';
        assert.throws(
            () => {return releases({
                apps: { scada: { image: 'example.invalid/plant:1' } },
                machines: [
                    { device: 'd1', id: machine, kind: 'unit', place: 'mill.hall' },
                    { device: 'd2', id: other, kind: 'unit', place: 'mill.hall' }
                ],
                nodes: [
                    {
                        api: [{ id: 'plant', url }],
                        id: 'cell',
                        implementation: { cluster: 'cell', profile: 'cell' },
                        fan_in: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
                        upstream: [{ objects: [machine], to: 'archive' }]
                    },
                    {
                        fan_in: [{ api: 'plant', from: 'cell', objects: [other] }],
                        id: 'archive',
                        implementation: { cluster: 'archive', profile: 'archive' }
                    }
                ],
                profiles: { archive: { modules: {} }, cell: { modules: {} } }
            }, 'archive')},
            'releases accepted an edge whose sides disagree'
        );
    });

    it('copies a telemetry record from fan-in', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const device = `d${Math.random().toString(36).slice(2, 8)}`;
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1' } },
            nodes: [{
                fan_in: [{ device, id: machine, kind: 'unit', place: 'mill.hall' }],
                id: 'cell',
                implementation: { cluster: 'cell', profile: 'cell' }
            }],
            profiles: { cell: { modules: {} } }
        }, 'cell');
        assert.strictEqual(
            cut.scada.machines[0].device,
            device,
            'releases dropped the telemetry record'
        );
    });

    it('does not call an edge that publishes no api', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const cut = releases({
            apps: { scada: { image: 'example.invalid/plant:1' } },
            nodes: [
                {
                    fan_in: [{ device: 'd', id: machine, kind: 'unit', place: 'mill.hall' }],
                    id: 'cell',
                    implementation: { cluster: 'cell', profile: 'cell' },
                    upstream: [{ objects: [machine], to: 'archive' }]
                },
                {
                    fan_in: [{ from: 'cell', objects: [machine] }],
                    id: 'archive',
                    implementation: { cluster: 'archive', profile: 'archive' }
                }
            ],
            profiles: { archive: { modules: {} }, cell: { modules: {} } }
        }, 'archive');
        assert.strictEqual(cut.scada.sites, undefined, 'releases called an edge that publishes no api');
    });

    it('rejects a cluster the document does not name', function() {
        const cluster = `missing${Math.random().toString(36).slice(2, 6)}`;
        assert.throws(
            () => {
                return releases({
                    apps: { scada: { image: 'example.invalid/plant:1' } },
                    machines: [],
                    nodes: [],
                    profiles: {}
                }, cluster);
            },
            'releases accepted a cluster the document does not name'
        );
    });
});
