import assert from 'assert';
import activityCodec from '../../../../src/infrastructure/ingest/activity/activityTransformer.js';

describe('activityCodec', function() {
    it('transforms traefik log entry to activity record', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        const log = {
            StartUTC: '2024-01-20T10:30:00.123Z',
            RequestMethod: 'GET',
            RequestPath: '/api/metrics',
            DownstreamStatus: 200,
            Duration: 45000000,
            ClientHost: '192.168.1.100',
            'request_Remote-User': 'admin',
            'request_Remote-Email': 'admin@example.com'
        };
        transformer.accept({ ts: Date.now(), line: JSON.stringify(log) });
        assert.strictEqual(received.length, 1, 'should accept one record');
        assert.strictEqual(received[0].user, 'admin', 'should extract user');
        assert.strictEqual(received[0].email, 'admin@example.com', 'should extract email');
        assert.strictEqual(received[0].method, 'GET', 'should extract method');
        assert.strictEqual(received[0].path, '/api/metrics', 'should extract path');
        assert.strictEqual(received[0].status, 200, 'should extract status');
        assert.strictEqual(received[0].ip, '192.168.1.100', 'should extract ip');
    });

    it('converts duration from nanoseconds to seconds', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        const log = {
            StartUTC: '2024-01-20T10:30:00Z',
            RequestMethod: 'GET',
            RequestPath: '/',
            DownstreamStatus: 200,
            Duration: 1500000000,
            ClientHost: '127.0.0.1'
        };
        transformer.accept({ ts: Date.now(), line: JSON.stringify(log) });
        assert.strictEqual(received[0].duration, 1.5, 'should convert ns to seconds');
    });

    it('skips non json log entries without crashing', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        transformer.accept({ ts: Date.now(), line: 'plain text log line' });
        transformer.accept({ ts: Date.now(), line: 'another invalid line' });
        assert.strictEqual(received.length, 0, 'should skip non-json entries');
    });

    it('handles missing optional fields gracefully', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        const log = {
            StartUTC: '2024-01-20T10:30:00Z',
            RequestMethod: 'GET',
            RequestPath: '/',
            DownstreamStatus: 200,
            Duration: 1000000,
            ClientHost: '127.0.0.1'
        };
        transformer.accept({ ts: Date.now(), line: JSON.stringify(log) });
        assert.strictEqual(received.length, 1, 'should accept record');
        assert.strictEqual(received[0].user, '', 'should default user to empty');
        assert.strictEqual(received[0].email, '', 'should default email to empty');
    });

    it('parses timestamp from StartUTC field', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        const log = {
            StartUTC: '2024-01-20T10:30:00.500Z',
            RequestMethod: 'GET',
            RequestPath: '/',
            DownstreamStatus: 200,
            Duration: 1000000,
            ClientHost: '127.0.0.1'
        };
        transformer.accept({ ts: Date.now(), line: JSON.stringify(log) });
        const expected = new Date('2024-01-20T10:30:00.500Z').getTime();
        assert.strictEqual(received[0].ts, expected, 'should parse timestamp');
    });

    it('handles unicode in path and user', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        const log = {
            StartUTC: '2024-01-20T10:30:00Z',
            RequestMethod: 'GET',
            RequestPath: '/api/areas',
            DownstreamStatus: 200,
            Duration: 1000000,
            ClientHost: '127.0.0.1',
            'request_Remote-User': 'Ivan'
        };
        transformer.accept({ ts: Date.now(), line: JSON.stringify(log) });
        assert.strictEqual(received[0].path, '/api/areas', 'should handle unicode path');
        assert.strictEqual(received[0].user, 'Ivan', 'should handle unicode user');
    });

    it('skips entries without required fields', function() {
        const received = [];
        const collector = { accept: (record) => {return received.push(record)} };
        const transformer = activityCodec(collector);
        transformer.accept({ ts: Date.now(), line: JSON.stringify({ foo: 'bar' }) });
        assert.strictEqual(received.length, 0, 'should skip incomplete entries');
    });
});
