import assert from 'node:assert/strict';
import streamTask from '../../../src/application/runtime/streamTask.js';
import taskBudget from '../../../src/application/runtime/taskBudget.js';

function setup() {
    let collector;
    const events = [];
    const signal = new AbortController();
    const context = { signal: signal.signal, budget: taskBudget({ maxBytes: 100, maxRecords: 1 }) };
    const factory = streamTask({ sources: new Map([['input', (config, target) => {
        collector = target;
        return { start() { events.push('source.start'); }, stop() { events.push('source.stop'); } };
    }]]), sinks: new Map([['output', () => {
        return { start() { events.push('sink.start'); }, write(rows) { events.push(rows); }, stop() { events.push('sink.stop'); } };
    }]]), transforms: new Map() });
    const spec = { source: { type: 'input' }, sinks: [{ type: 'output' }], delivery: 'live' };
    return { factory, spec, context, events, signal, accept(value) { return collector.accept(value); } };
}
describe('universal stream composition', () => {
    it('opens sinks before sources, forwards data and closes in reverse order', async () => {
        const test = setup();
        test.factory.validate(test.spec);
        const task = test.factory.create(test.spec, test.context);
        await task.start();
        await test.accept({ value: 2 });
        await task.stop();
        assert.deepEqual(test.events, ['sink.start', 'source.start', [{ value: 2 }], 'source.stop', 'sink.stop']);
        assert.deepEqual(test.context.budget.status(), { bytes: 0, records: 0 });
    });
    it('rejects deliveries after revocation before calling any sink', async () => {
        const test = setup();
        const task = test.factory.create(test.spec, test.context);
        await task.start();
        test.signal.abort();
        await assert.rejects(test.accept({ value: 2 }), /abort/iu);
        assert.deepEqual(test.events, ['sink.start', 'source.start']);
        await task.stop();
    });
    it('rejects unsupported source and implicit delivery policy before opening connections', () => {
        const test = setup();
        assert.throws(() => { test.factory.validate({ ...test.spec, source: { type: 'missing' } }); }, /source/u);
        assert.throws(() => { test.factory.validate({ ...test.spec, delivery: undefined }); }, /delivery/u);
        assert.deepEqual(test.events, []);
    });
});


describe('stream recovery boundaries', () => {
    it('does not open sinks after a revoked asynchronous state load', async () => {
        const test = setup();
        let loaded;
        test.context.taskId = 'one';
        test.context.stateStore = { load() { return new Promise((resolve) => { loaded = resolve; }); } };
        const task = test.factory.create({ ...test.spec, delivery: 'durable', stateVersion: 1, compatibilityKey: 'one' }, test.context);
        const opening = task.start();
        await new Promise(setImmediate);
        test.signal.abort();
        await task.stop();
        loaded(null);
        await assert.rejects(opening, /abort/iu);
        assert.deepEqual(test.events, ['source.stop', 'sink.stop']);
    });
    it('resumes failed recipients without repeating successful recipients', async () => {
        let collector;
        let saved = null;
        let down = true;
        const writes = [];
        const factory = streamTask({ transforms: new Map(), sources: new Map([['input', (spec, target) => {
            collector = target;
            return { start() {}, stop() {} };
        }]]), sinks: new Map([['amqp', (spec) => { return { start() {}, stop() {}, async write(rows) {
            if (spec.id === 'b' && down) { throw new Error('offline'); }
            writes.push([spec.id, rows[0]]);
        } }; }]]) });
        const context = { taskId: 'one', signal: new AbortController().signal, budget: taskBudget({ maxBytes: 10000, maxRecords: 1 }),
            stateStore: { async load() { return saved; }, async commit(next) { saved = { ...next, version: next.expectedVersion + 1 }; return saved.version; } } };
        const task = factory.create({ delivery: 'durable', stateVersion: 1, compatibilityKey: 'one', source: { type: 'input' },
            sinks: [{ type: 'amqp', id: 'a' }, { type: 'amqp', id: 'b' }] }, context);
        await task.start();
        const event = { eventId: 'e1', body: 'x', exchange: 'e', routingKey: 'r' };
        await assert.rejects(collector.accept(event), /offline/u);
        down = false;
        await collector.accept(event);
        assert.deepEqual(writes.map(([id]) => { return id; }), ['a', 'b']);
        assert.deepEqual(writes[0][1].options, { persistent: true, mandatory: true, messageId: 'e1' });
        assert.equal(saved.pending, null);
        await task.stop();
    });
});

describe('offline spooled stream', () => {
    it('collects without opening network sinks and queues stable events', async () => {
        const test = setup();
        test.factory = streamTask({ sources: new Map([['input', (spec, target) => {
            test.accept = (value) => { return target.accept(value); };
            return { start() {}, stop() {} };
        }]]), sinks: new Map([['amqp', () => { throw new Error('must not open network sink'); }]]), transforms: new Map() });
        const rows = [];
        test.context.deliveryQueue = { async accept(event, recipients) { rows.push({ event, recipients }); } };
        const spec = { delivery: 'spooled', source: { type: 'input' }, sinks: [{ id: 'one', type: 'amqp', url: 'amqp://host' }] };
        test.factory.validate(spec);
        const task = test.factory.create(spec, test.context);
        await task.start(); await test.accept({ value: 4 }); await task.stop();
        assert.equal(rows.length, 1);
        assert.equal(typeof rows[0].event.eventId, 'string');
        assert.equal(rows[0].recipients[0].id, 'one');
    });
});
