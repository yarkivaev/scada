import assert from 'node:assert/strict';
import runCollector from '../../../src/application/runtime/runCollector.js';

function registry(events) {
    return new Map([['test', { validate() {}, resources() { return []; }, create(spec) {
        return { start() { events.push(`start:${spec.value}`); }, stop() { events.push(`stop:${spec.value}`); } };
    } }]]);
}
function document(value) {
    return { assignments: [{ taskId: 'one', generation: value, specVersion: 1, spec: { adapter: 'test', value } }] };
}
describe('collector manifest entrypoint', () => {
    it('starts the same runtime from a JSON manifest and reloads explicit revisions', async () => {
        const events = [];
        const env = { COLLECTOR_MANIFEST: JSON.stringify(document(1)) };
        const collector = await runCollector({ registry: registry(events), env, argv: [], signals: false });
        await collector.reload();
        env.COLLECTOR_MANIFEST = JSON.stringify(document(2));
        await collector.reload();
        await collector.stop();
        assert.deepEqual(events, ['start:1', 'stop:1', 'start:2', 'stop:2']);
    });
    it('validates the entire manifest before any task starts', async () => {
        const events = [];
        const manifest = document(1);
        manifest.assignments.push({ taskId: 'two', generation: 1, specVersion: 1, spec: { adapter: 'missing' } });
        await assert.rejects(runCollector({ registry: registry(events), env: { COLLECTOR_MANIFEST: JSON.stringify(manifest) }, argv: [], signals: false }), /adapter/u);
        assert.deepEqual(events, []);
    });
    it('applies explicit removals idempotently on reload', async () => {
        const events = [];
        const env = { COLLECTOR_MANIFEST: JSON.stringify(document(1)) };
        const collector = await runCollector({ registry: registry(events), env, argv: [], signals: false });
        env.COLLECTOR_MANIFEST = JSON.stringify({ assignments: [], removals: [{ taskId: 'one', generation: 2 }] });
        await collector.reload();
        await collector.reload();
        assert.deepEqual(events, ['start:1', 'stop:1']);
        await collector.stop();
    });
    it('gives adapters a supplied control cursor', async () => {
        let seen;
        const cursor = { load() { return { id: 4 }; }, save() { return undefined; } };
        const collector = await runCollector({
            registry: new Map([['test', { validate() {}, resources() { return []; }, create(_spec, ctx) {
                seen = ctx.cursor;
                return { start() {}, stop() {} };
            } }]]),
            env: { COLLECTOR_MANIFEST: JSON.stringify({ assignments: [{ taskId: 'sokol-awgs:cm1', generation: 1, specVersion: 1, spec: { adapter: 'test' } }] }) },
            argv: [], signals: false, cursor
        });
        await collector.reload();
        assert.equal(seen, cursor, 'adapter did not receive the control cursor');
        await collector.stop();
    });
});
