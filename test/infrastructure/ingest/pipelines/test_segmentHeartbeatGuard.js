import assert from 'assert';
import { checkSplit, splitRows } from '../../../../src/domain/segment/splitFamily.js';
import { segmentUpdateWhere } from '../../../../src/infrastructure/ingest/pipelines/segmentPipeline.js';

function like(text, wildcard) {
    const parts = wildcard.split('%').map((part) => {
        return part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    });
    return new RegExp(`^${parts.join('.*')}$`, 'u').test(text);
}

function likePattern() {
    const found = segmentUpdateWhere.match(/LIKE '(?<wildcard>[^']*)'/u);
    return found.groups.wildcard;
}

function allows(existing, incoming, kin = []) {
    const props = existing.properties === null || existing.properties === undefined ? '' : String(existing.properties);
    const later = Date.parse(incoming.end_time) > Date.parse(existing.end_time);
    const clause = existing.duration === 0 || incoming.duration > 0 || later;
    const family = kin.some((row) => {
        return Date.parse(row.start_time) > Date.parse(existing.start_time) && like(String(row.properties ?? ''), likePattern());
    });
    const blocked = existing.duration > 0 && incoming.duration === 0 && like(props, likePattern()) && family;
    return clause && !blocked;
}

describe('segmentUpdateWhere split heartbeat', function() {
    it('does not let a later duration-0 heartbeat extend a closed split piece', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        const rows = splitRows('линия-π', checkSplit({
            name: 'off', start_time: start, end_time: end, duration: 360
        }, [
            { start, end: cut, tag: 'этап_б' },
            { start: cut, end, tag: '' }
        ]));
        const later = new Date(end.getTime() + 90000).toISOString();
        assert.strictEqual(allows({
            duration: rows[0].duration,
            start_time: rows[0].start_time,
            end_time: rows[0].end_time,
            properties: rows[0].properties
        }, { duration: 0, end_time: later }, [rows[1]]), false, 'a duration-0 heartbeat extended a closed split piece');
    });
    it('still extends a silence-closed native split tail', function() {
        const start = new Date('2026-11-17T04:38:14.235Z');
        const frozen = new Date('2026-11-17T09:12:27.378Z').toISOString();
        const later = new Date('2026-11-17T11:01:58.618Z').toISOString();
        assert.strictEqual(allows({
            duration: 16453.143,
            start_time: start.toISOString(),
            end_time: frozen,
            properties: JSON.stringify({ split_of: String(start.getTime()) })
        }, { duration: 0, end_time: later }), true, 'a later heartbeat could not reopen a singleton split tail');
    });

    it('still extends a closed segment that is not a split piece', function() {
        const start = new Date('2026-10-19T11:11:11.137Z');
        const frozen = new Date(start.getTime() + 120000).toISOString();
        const later = new Date(start.getTime() + 240000).toISOString();
        assert.strictEqual(allows({
            duration: 120,
            end_time: frozen,
            properties: '{}'
        }, { duration: 0, end_time: later }), true, 'a later heartbeat could not continue an ordinary closed segment');
    });

    it('still extends an open split tail', function() {
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const now = new Date(start.getTime() + 360000);
        const rows = splitRows('линия-π', checkSplit({
            name: 'off', start_time: start, end_time: now, duration: 0
        }, [
            { start, end: cut, tag: 'этап_б' },
            { start: cut, end: now, tag: '', open: true }
        ]));
        const later = new Date(now.getTime() + 90000).toISOString();
        assert.strictEqual(allows({
            duration: rows[1].duration,
            end_time: rows[1].end_time,
            properties: rows[1].properties
        }, { duration: 0, end_time: later }), true, 'a duration-0 heartbeat could not extend an open split tail');
    });
});
