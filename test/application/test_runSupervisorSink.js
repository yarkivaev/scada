import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import runSupervisorSink from '../../src/application/runSupervisorSink.js';

describe('supervisor sink process ownership', () => {
    it('passes transport health to HTTP and rejects the service on terminal failure', async () => {
        let report; let started = false; let httpHealth;
        const health = () => {return { ready: true, live: true }};
        const result = runSupervisorSink({}, {
            sinkFactory(_env, options) {
                report = options.onFatal;
                return { dataAccess: {}, apiPort: 0, health, async run(api) { api.start(); } };
            },
            apiFactory(_data, options) {
                httpHealth = options.health;
                return { start() { started = true; } };
            }
        });
        await delay(0);
        assert.equal(started, true);assert.equal(httpHealth, health);
        const error = new Error('terminal reader failure');report(error);
        await assert.rejects(result, error);
    });
});
