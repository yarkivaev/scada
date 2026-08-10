import assert from 'assert';
import timelineOperator from '../../../../src/infrastructure/http/plant/timelineOperator.js';

describe('timelineOperator anonymous clients', function () {
    it('uses the configured anonymousUsers map for a known client', async function () {
        const label = `Anon_${Math.floor(Math.random() * 9000 + 1000)}`;
        const gate = timelineOperator({
            defaultUser: 'hmi-kiosk',
            anonymousUsers: { monitoring: label }
        });
        const audit = await gate.resolve({ client: 'monitoring' });
        assert.strictEqual(audit.displayName, label, 'known client ignored anonymousUsers map');
    });

    it('keeps the configured default when client is unknown', async function () {
        const fallback = `legacy-${Math.floor(Math.random() * 9000 + 1000)}`;
        const gate = timelineOperator({
            defaultUser: fallback,
            anonymousUsers: { hmi: 'Anonymous HMI user' }
        });
        const audit = await gate.resolve({ client: `tablet-${Math.floor(Math.random() * 90 + 10)}` });
        assert.strictEqual(audit.displayName, fallback, 'unknown client overrode the configured default user');
    });

    it('falls back to defaultUser when anonymousUsers is omitted', async function () {
        const fallback = `default-${Math.floor(Math.random() * 9000 + 1000)}`;
        const gate = timelineOperator({ defaultUser: fallback });
        const audit = await gate.resolve({ client: 'hmi' });
        assert.strictEqual(audit.displayName, fallback, 'missing anonymousUsers did not use defaultUser');
    });
});
