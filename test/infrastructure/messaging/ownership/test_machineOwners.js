import assert from 'assert';
import machineOwners from '../../../../src/infrastructure/messaging/ownership/machineOwners.js';

describe('machineOwners', function() {
    it('resolves edge ownership for listed machines', function() {
        const site = `http://edge-${Math.random()}.local/api/v1`;
        const machine = `m-π-${Math.floor(Math.random() * 9000 + 1000)}`;
        const owners = machineOwners([{ baseUrl: site, token: 'tøkën', machines: [machine] }]);
        assert.deepStrictEqual(
            owners.resolve(machine),
            { kind: 'edge', baseUrl: site, token: 'tøkën' },
            'listed machine was not resolved as edge owner'
        );
    });

    it('resolves unknown machines as local', function() {
        const machine = `central-φ-${Math.floor(Math.random() * 9000 + 1000)}`;
        const owners = machineOwners([{
            baseUrl: 'http://edge.example/api/v1',
            machines: [`other-${Math.random()}`]
        }]);
        assert.deepStrictEqual(
            owners.resolve(machine),
            { kind: 'local' },
            'unknown machine was not resolved as local'
        );
    });

    it('treats empty sites as all-local', function() {
        const machine = `m-${Math.random()}`;
        assert.strictEqual(
            machineOwners([]).resolve(machine).kind,
            'local',
            'empty sites registry did not default to local'
        );
    });
});
