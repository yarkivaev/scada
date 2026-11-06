import assert from 'node:assert/strict';
import ingestHealth from '../../src/application/ingestHealth.js';

describe('ingest service health', () => {
    it('requires startup and every broker source, including quiet subscriptions', () => {
        const states = ['starting', 'running', 'running'];
        const health = ingestHealth();
        health.track(states.map((_state, i) => {return { health() { return { state: states[i] }; } }}));
        assert.equal(health.status().ready, false);
        health.started(); assert.equal(health.status().ready, false);
        states[0] = 'running'; assert.equal(health.status().ready, true);
        states[1] = 'degraded'; assert.equal(health.status().ready, false);
        assert.equal(health.status().live, true);
        states[1] = 'running'; assert.equal(health.status().ready, true);
    });
    it('reports a terminal failure once and never advertises recovery of the old executor', () => {
        const failures = []; const health = ingestHealth({ onFatal(error) { failures.push(error); } });
        health.track([{ health() { return { state: 'running' }; } }]);health.started();
        const error = new Error('uncertain write');health.fail(error);health.fail(new Error('secondary'));
        assert.deepEqual(failures, [error]);
        assert.deepEqual(health.status(), { ready: false, live: false });
    });
    it('supports the explicit HTTP-only mode without waiting for nonexistent readers', () => {
        const health = ingestHealth();health.track([]);health.started();
        assert.deepEqual(health.status(), { ready: true, live: true });
    });
});
