import assert from 'assert';
import segmentCodec from '../../../../src/infrastructure/ingest/codecs/segmentCodec.js';
import { segmentDispatch } from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

function fakeCloser() {
    return { close() { return Promise.resolve(); } };
}

describe('segmentCodec', function() {
    it('transforms valid segment payload to record', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'on',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600,
            options: { power: 100 }
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received.length, 1, 'should accept one record');
        assert.strictEqual(received[0].machine, 'icht2', 'should extract machine');
        assert.strictEqual(received[0].name, 'on', 'should extract name');
        assert.strictEqual(received[0].duration, 3600, 'should extract duration');
    });

    it('converts epoch timestamps to ISO strings', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'heating',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].start_time, new Date(1700000000000).toISOString(), 'should convert start to ISO');
        assert.strictEqual(received[0].end_time, new Date(1700003600000).toISOString(), 'should convert end to ISO');
    });

    it('throws on missing required fields', async function() {
        const collector = { accept: async () => {} };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({ start: 1700000000000, end: 1700003600000, duration: 3600 });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.segments', payload }); },
            /Segment missing machine field/u,
            'did not throw on missing machine'
        );
    });

    it('throws on invalid timestamp', async function() {
        const collector = { accept: async () => {} };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({ machine: 'ичт2', name: 'нагрев', start: 'вчера', end: 1700003600000, duration: 3600 });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.segments', payload }); },
            { name: 'RangeError' },
            'did not throw on non-numeric start'
        );
    });

    it('handles unicode in segment name', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'ичт2',
            name: 'нагрев',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].name, 'нагрев', 'should handle unicode name');
    });

    it('sets options to null when absent', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'off',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].options, null, 'should set options to null');
    });

    it('preserves tags as JSON string', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const tags = [`нагрев_${Math.random()}`];
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'on',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600,
            tags
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].tags, JSON.stringify(tags), 'should preserve tags as JSON');
    });

    it('preserves properties as JSON string', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const properties = { weight: Math.floor(Math.random() * 1000) };
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'off',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600,
            tags: ['charge_loading'],
            properties
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].properties, JSON.stringify(properties), 'should preserve properties as JSON');
    });

    it('sets resolved to false when options present', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'off',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600,
            options: ['charge_loading', 'lining_inspection']
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].resolved, false, 'should set resolved to false when options present');
    });

    it('sets resolved to true when options absent', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'on',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].resolved, true, 'should set resolved to true when options absent');
    });

    it('sets tags to null when absent', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'on',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].tags, null, 'should set tags to null when absent');
    });

    it('passes through type field', async function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = segmentCodec(collector);
        const type = ['segment', 'retag', 'split'][Math.floor(Math.random() * 3)];
        const payload = JSON.stringify({
            machine: 'icht2',
            name: 'нагрев',
            start: 1700000000000,
            end: 1700003600000,
            duration: 3600,
            type
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(received[0].type, type, 'should pass through type field');
    });

    it('throws on missing collector', function() {
        assert.throws(
            () => { segmentCodec(null); },
            /Collector must have an accept\(\) method/u,
            'should reject missing collector'
        );
    });
});

describe('segmentCodec propagates downstream write failure', function() {
    it('rejects when downstream sink write fails', async function() {
        const sink = {
            write() { return Promise.reject(new Error('database unreachable')); }
        };
        const retag = { accept() { return Promise.resolve(); } };
        const router = segmentDispatch(sink, retag, sink, fakeCloser());
        const codec = segmentCodec(router);
        const payload = JSON.stringify({
            type: 'segment',
            machine: `icht${Math.random()}`,
            name: 'on',
            start: Date.now(),
            end: Date.now() + 5000,
            duration: 5
        });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.segments', payload }); },
            /database unreachable/u,
            'Should propagate write failure through codec'
        );
    });
});

describe('segmentCodec full chain with segmentDispatch', function() {
    it('rejects through codec and router when sink fails', async function() {
        const failing = { write() { return Promise.reject(new Error('disk full')); } };
        const retag = { accept() { return Promise.resolve(); } };
        const router = segmentDispatch(failing, retag, failing, fakeCloser());
        const codec = segmentCodec(router);
        const payload = JSON.stringify({
            type: 'segment',
            machine: `icht${Math.random()}`,
            name: 'off',
            start: Date.now(),
            end: Date.now() + 3000,
            duration: 3
        });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.segments', payload }); },
            /disk full/u,
            'Should propagate failure through entire chain'
        );
    });

    it('resolves through codec and router when sink succeeds', async function() {
        const written = [];
        const sink = { write(recs) { written.push(...recs); return Promise.resolve(); } };
        const retag = { accept() { return Promise.resolve(); } };
        const router = segmentDispatch(sink, retag, sink, fakeCloser());
        const codec = segmentCodec(router);
        const payload = JSON.stringify({
            type: 'segment',
            machine: `icht${Math.random()}`,
            name: 'on',
            start: Date.now(),
            end: Date.now() + 5000,
            duration: 5
        });
        await codec.accept({ destination: '/exchange/scada.segments', payload });
        assert.strictEqual(written.length, 1, 'Should write through entire chain on success');
    });
});
