import assert from 'node:assert';
import releases from '../../src/application/deploy/releases.js';
import readDocument from '../../src/application/deploy/readDocument.js';
import expand from '../../src/application/deploy/expand.js';
import { bindModules } from '../../src/application/deploy/releaseValues.js';

describe('mdmesh module', function() {
    it('preserves chart settings and namespace', function() {
        assert.deepStrictEqual(bindModules({ modules: { mdmesh: {
            namespace: 'mesh-space', chart: { image: 'example.invalid/mesh:37', service: { port: 8417 } }
        } } }).mdmesh, {
            image: 'example.invalid/mesh:37', service: { port: 8417 }, namespace: 'mesh-space', enabled: true
        }, 'module binding lost mesh deployment settings');
    });

    it('lets a server disable and override its profile module', function() {
        const cut = releases({
            profiles: { edge: { apps: { scada: { image: 'example.invalid/scada:37' } }, modules: {
                mdmesh: { enabled: true, namespace: 'mesh-space', chart: { service: { port: 8417 }, replicas: 2 } }
            } } },
            servers: [{ id: 'edge2', profile: { id: 'edge', variables: { cluster: 'edge2' } },
                modules: { mdmesh: { enabled: false, chart: { replicas: 3 } } } }]
        }, 'edge2');
        assert.deepStrictEqual(cut.scada.mdmesh, {
            enabled: false, namespace: 'mesh-space', service: { port: 8417 }, replicas: 3
        }, 'release projection ignored server mesh overrides');
    });

    it('preserves an included root catalog during expansion', function() {
        const document = readDocument('include: catalog.yaml\nprofiles: {}\nservers: []\n', () => {
            return 'hmi:\n  screens:\n    overview:\n      title: Overview\n';
        });
        assert.deepStrictEqual(expand(document).hmi, { screens: { overview: { title: 'Overview' } } },
            'expansion lost the included root catalog');
    });

    it('preserves the root catalog alongside release values', function() {
        const hmi = { screens: { overview: { title: 'Overview' } } };
        const cut = releases({ hmi,
            profiles: { edge: { apps: { scada: { image: 'example.invalid/scada:37' } } } },
            servers: [{ id: 'edge2', profile: { id: 'edge', variables: { cluster: 'edge2' } } }]
        }, 'edge2');
        assert.deepStrictEqual(cut.hmi, hmi, 'release projection lost the root catalog');
    });
});
