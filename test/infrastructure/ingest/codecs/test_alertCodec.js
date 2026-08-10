import assert from 'assert';
import alertCodec from '../../../../src/infrastructure/ingest/codecs/alertCodec.js';
import alertSink from '../../../../src/infrastructure/ingest/sinks/alertSink.js';

describe('alertCodec', function() {
    it('translates known rule name to human-readable message', function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const translations = { low_cosphi: 'Switch off compensation' };
        const codec = alertCodec(collector, translations);
        const payload = JSON.stringify({
            name: 'low_cosphi',
            machine: `m${Math.random()}`,
            severity: 'warning',
            status: 'pending',
            start: 1700000000000
        });
        codec.accept({ destination: '/exchange/scada.alerts', payload });
        assert.strictEqual(received[0].message, 'Switch off compensation', 'known rule name was not translated');
    });

    it('falls back to rule name for unknown rules', function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = alertCodec(collector, {});
        const name = `unknown_rule_${Math.random()}`;
        const payload = JSON.stringify({
            name,
            machine: 'm2',
            severity: 'warning',
            status: 'pending',
            start: 1700000000000
        });
        codec.accept({ destination: '/exchange/scada.alerts', payload });
        assert.strictEqual(received[0].message, name, 'unknown rule name was not used as fallback');
    });

    it('passes status and severity fields through', function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = alertCodec(collector, {});
        const severity = `severity${Math.random()}`;
        const status = `status${Math.random()}`;
        const payload = JSON.stringify({
            name: 'low_cosphi',
            machine: 'm2',
            severity,
            status,
            start: 1700000000000
        });
        codec.accept({ destination: '/exchange/scada.alerts', payload });
        assert.strictEqual(received[0].severity, severity, 'severity was not passed through');
    });

    it('converts epoch timestamps to ISO strings', function() {
        const received = [];
        const collector = { accept: (record) => { return received.push(record); } };
        const codec = alertCodec(collector, {});
        const epoch = 1700000000000 + Math.floor(Math.random() * 100000000);
        const payload = JSON.stringify({
            name: 'low_cosphi',
            machine: 'm2',
            severity: 'warning',
            status: 'pending',
            start: epoch
        });
        codec.accept({ destination: '/exchange/scada.alerts', payload });
        assert.strictEqual(received[0].timestamp, new Date(epoch).toISOString(), 'epoch was not converted to ISO string');
    });

    it('throws on missing name field', async function() {
        const collector = { accept: () => {} };
        const codec = alertCodec(collector, {});
        const payload = JSON.stringify({ machine: 'm2', severity: 'warning', status: 'pending', start: 1700000000000 });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.alerts', payload }); },
            /Alert missing name field/u,
            'did not throw on missing name'
        );
    });

    it('throws on missing machine field', async function() {
        const collector = { accept: () => {} };
        const codec = alertCodec(collector, {});
        const payload = JSON.stringify({ name: 'low_cosphi', severity: 'warning', status: 'pending', start: 1700000000000 });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.alerts', payload }); },
            /Alert missing machine field/u,
            'did not throw on missing machine'
        );
    });

    it('throws on invalid timestamp', async function() {
        const collector = { accept: () => {} };
        const codec = alertCodec(collector, {});
        const payload = JSON.stringify({ name: 'low_power_factor', machine: 'm2', severity: 'warning', status: 'pending', start: 'yesterday' });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.alerts', payload }); },
            { name: 'RangeError' },
            'did not throw on non-numeric start'
        );
    });

    it('throws on missing collector', function() {
        assert.throws(
            () => { alertCodec(null, {}); },
            /Collector must have an accept\(\) method/u,
            'should reject missing collector'
        );
    });
});

describe('alertCodec propagates downstream accept failure', function() {
    it('rejects when downstream sink accept fails', async function() {
        const sink = {
            accept() { return Promise.reject(new Error('alert insert failed')); }
        };
        const codec = alertCodec(sink, {});
        const payload = JSON.stringify({
            name: 'low_cosphi',
            machine: `m${Math.random()}`,
            severity: 'warning',
            status: 'pending',
            start: Date.now()
        });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.alerts', payload }); },
            /alert insert failed/u,
            'Should propagate sink failure through alert codec'
        );
    });

    it('resolves when downstream sink accept succeeds', async function() {
        const received = [];
        const sink = {
            accept(r) { received.push(r); return Promise.resolve(); }
        };
        const codec = alertCodec(sink, {});
        const payload = JSON.stringify({
            name: `rule_${Math.random()}`,
            machine: `m${Math.random()}`,
            severity: 'warning',
            status: 'pending',
            start: Date.now()
        });
        await codec.accept({ destination: '/exchange/scada.alerts', payload });
        assert.strictEqual(received.length, 1, 'Should deliver alert on success');
    });
});

describe('alertCodec full chain with alertSink', function() {
    it('rejects through alertCodec when alertSink fails', async function() {
        const pool = {
            query() { return Promise.reject(new Error('connection refused')); }
        };
        const sink = alertSink(pool);
        const codec = alertCodec(sink, {});
        const payload = JSON.stringify({
            name: `rule_${Math.random()}`,
            machine: `m${Math.random()}`,
            severity: 'warning',
            status: 'pending',
            start: Date.now()
        });
        await assert.rejects(
            () => { return codec.accept({ destination: '/exchange/scada.alerts', payload }); },
            /connection refused/u,
            'Should propagate failure through alert chain'
        );
    });
});
