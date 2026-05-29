import assert from 'assert';
import userDecisionCodec from '../../../../src/infrastructure/ingest/codecs/userDecisionCodec.js';
import userDecisionSink from '../../../../src/infrastructure/ingest/sinks/userDecisionSink.js';

describe('userDecisionCodec', function() {
    it('extracts machine field', async function() {
        const received = [];
        const collector = { accept: (r) => { received.push(r); return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const machine = `ičt-${Math.random()}`;
        const payload = JSON.stringify({ machine, start: 1700000000000, user: 'оператор1' });
        await codec.accept({ destination: '/exchange/scada.user_decisions', payload });
        assert.strictEqual(received[0].machine, machine, 'machine field was not extracted');
    });

    it('translates start epoch to ISO start_time', async function() {
        const received = [];
        const collector = { accept: (r) => { received.push(r); return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const start = 1700000000000 + Math.floor(Math.random() * 100000000);
        const payload = JSON.stringify({ machine: 'icht2', start, user: 'оператор1' });
        await codec.accept({ destination: '/exchange/scada.user_decisions', payload });
        assert.strictEqual(received[0].startTime, new Date(start).toISOString(), 'start was not converted to ISO');
    });

    it('extracts username field', async function() {
        const received = [];
        const collector = { accept: (r) => { received.push(r); return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const user = `оператор_${Math.random()}`;
        const payload = JSON.stringify({ machine: 'ičt-ñ', start: 1700000000000, user });
        await codec.accept({ destination: '/exchange/scada.user_decisions', payload });
        assert.strictEqual(received[0].username, user, 'user field was not extracted as username');
    });

    it('passes raw JSON payload through unchanged', async function() {
        const received = [];
        const collector = { accept: (r) => { received.push(r); return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const raw = JSON.stringify({ machine: 'ičt-ñ', start: 1700000000000, user: 'оп1',
            tags: [`нагрев_${Math.random()}`], properties: {} });
        await codec.accept({ destination: '/exchange/scada.user_decisions', payload: raw });
        assert.strictEqual(received[0].payload, raw, 'raw payload was not preserved');
    });

    it('throws on missing machine field', async function() {
        const collector = { accept: () => { return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const payload = JSON.stringify({ start: 1700000000000, user: 'оп1' });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.user_decisions', payload }); },
            /Decision missing machine field/u,
            'did not throw on missing machine'
        );
    });

    it('throws on missing user field', async function() {
        const collector = { accept: () => { return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const payload = JSON.stringify({ machine: 'ičt-ñ', start: 1700000000000 });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.user_decisions', payload }); },
            /Decision missing user field/u,
            'did not throw on missing user'
        );
    });

    it('throws RangeError on non-numeric start', async function() {
        const collector = { accept: () => { return Promise.resolve(); } };
        const codec = userDecisionCodec(collector);
        const payload = JSON.stringify({ machine: 'ičt-ñ', start: 'вчера', user: 'оп1' });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.user_decisions', payload }); },
            { name: 'RangeError' },
            'did not throw RangeError on non-numeric start'
        );
    });

    it('throws on missing collector', function() {
        assert.throws(
            () => { userDecisionCodec(null); },
            /Collector must have an accept\(\) method/u,
            'did not throw on missing collector'
        );
    });
});

describe('userDecisionCodec full chain with userDecisionSink', function() {
    it('rejects through userDecisionCodec when sink fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('disk full')); }
        };
        const sink = userDecisionSink(pool);
        const codec = userDecisionCodec(sink);
        const payload = JSON.stringify({
            machine: `icht${Math.random()}`,
            start: Date.now(),
            user: `оператор_${Math.random()}`
        });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.user_decisions', payload }); },
            /disk full/u,
            'Should propagate failure through decision chain'
        );
    });
});
