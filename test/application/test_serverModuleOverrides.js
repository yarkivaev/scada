import assert from 'node:assert/strict';
import releases from '../../src/application/deploy/releases.js';

function document() {
    return {
        profiles: { cell: { apps: { scada: { image: 'example/api:1' } }, modules: {
            state_store: { enabled: true, pgdata: '/profile/data', chart: { image: 'postgres:16', existingClaim: 'database-data', storage: '50Gi', env: { LANG: 'C', TZ: 'UTC' } } },
            message_bus: { enabled: true, chart: { storage: '2Gi' } }
        } } },
        servers: [
            { id: 'first', profile: { id: 'cell', variables: { cluster: 'first' } }, modules: { state_store: { pgdata: '/first/data' } } },
            { id: 'second', profile: { id: 'cell', variables: { cluster: 'second' } } }
        ]
    };
}
describe('server module overrides', () => {
    it('overrides PGDATA for one server while inheriting the profile storage configuration', () => {
        const input = document();
        const original = structuredClone(input);
        const first = releases(input, 'first').scada;
        const second = releases(input, 'second').scada;
        assert.equal(first.postgres.data, '/first/data');
        assert.equal(second.postgres.data, '/profile/data');
        assert.equal(first.postgres.existingClaim, 'database-data');
        assert.equal(first.postgres.storage, '50Gi');
        assert.equal(first.postgres.image, 'postgres:16');
        assert.deepEqual(first.rabbitmq, second.rabbitmq);
        assert.deepEqual(input, original);
    });
    it('deep-merges module chart settings without losing sibling fields or other modules', () => {
        const input = document();
        input.servers[0].modules.state_store.chart = { env: { TZ: 'Europe/Moscow' }, storage: '60Gi' };
        const values = releases(input, 'first').scada;
        assert.deepEqual(values.postgres.env, { LANG: 'C', TZ: 'Europe/Moscow' });
        assert.equal(values.postgres.storage, '60Gi');
        assert.equal(values.postgres.existingClaim, 'database-data');
        assert.equal(values.rabbitmq.storage, '2Gi');
    });
    it('preserves chart data compatibility when no pgdata field is declared', () => {
        const input = document();
        delete input.profiles.cell.modules.state_store.pgdata;
        delete input.servers[0].modules.state_store.pgdata;
        input.profiles.cell.modules.state_store.chart.data = '/chart/data';
        assert.equal(releases(input, 'first').scada.postgres.data, '/chart/data');
    });
});
