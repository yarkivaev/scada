import assert from 'assert';
import historyFold from '../../../src/domain/segment/historyFold.js';

function stamp(origin, offset) {
    return new Date(origin + offset).toISOString();
}

function phase(name, start, end, tags, properties) {
    return {
        kind: 'phase',
        name,
        start_time: start,
        end_time: end,
        duration: (Date.parse(end) - Date.parse(start)) / 1000,
        tags: JSON.stringify(tags),
        properties: properties ? JSON.stringify(properties) : null
    };
}

describe('historyFold', function () {
    it('does not insert a second heating over a tagged interval', function () {
        const origin = 1_701_500_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const inner = stamp(origin, 24_000);
        const finish = stamp(origin, 36_000);
        const stored = [phase('on', start, stamp(origin, 25_000), ['нагрев-α'])];
        const incoming = [phase('on', inner, finish, [])];
        assert.equal(historyFold(stored, incoming).length, 1,
            'a later stream opened a second heating over a tagged interval');
    });
    it('keeps the operator tag while a later stream extends heating', function () {
        const origin = 1_701_600_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const stored = [phase('on', start, stamp(origin, 20_000), ['нагрев-β'])];
        const incoming = [phase('on', stamp(origin, 8_000), stamp(origin, 40_000), [])];
        assert.equal(historyFold(stored, incoming)[0].tags, JSON.stringify(['нагрев-β']),
            'a later stream replaced the operator heating tag');
    });
    it('moves the tagged heating end with a later stream', function () {
        const origin = 1_701_700_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const finish = stamp(origin, 40_000);
        const stored = [phase('on', start, stamp(origin, 20_000), ['нагрев-γ'])];
        const incoming = [phase('on', stamp(origin, 8_000), finish, [])];
        assert.equal(Date.parse(historyFold(stored, incoming)[0].end_time), Date.parse(finish),
            'a later stream left the tagged heating end behind');
    });
    it('does not move an internal split cut', function () {
        const origin = 1_701_800_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['в_ковш-α'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['шлак-α'], { split_of: key });
        const incoming = [phase('off', stamp(origin, 0), stamp(origin, 30_000), [])];
        const folded = historyFold([first, second], incoming);
        assert.equal(Date.parse(folded[1].start_time), origin + 10_000,
            'a later stream moved an operator split cut');
    });
    it('keeps split piece tags', function () {
        const origin = 1_701_900_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['в_ковш-β'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['шлак-β'], { split_of: key });
        const folded = historyFold([first, second], [phase('off', stamp(origin, 0), stamp(origin, 30_000), [])]);
        assert.deepEqual(folded.map((row) => { return row.tags; }),
            [JSON.stringify(['в_ковш-β']), JSON.stringify(['шлак-β'])],
            'a later stream replaced split piece tags');
    });
    it('extends only the last split piece', function () {
        const origin = 1_702_000_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['в_ковш-γ'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['шлак-γ'], { split_of: key });
        const finish = stamp(origin, 30_000);
        const folded = historyFold([first, second], [phase('off', stamp(origin, 0), finish, [])]);
        assert.equal(Date.parse(folded[1].end_time), Date.parse(finish),
            'a later stream did not extend the last split piece');
    });
    it('collapses overlapping unsplit heatings onto the earlier start', function () {
        const origin = 1_702_100_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const inner = stamp(origin, 24_079);
        const finish = stamp(origin, 36_000);
        const stored = [
            phase('on', start, finish, ['heating']),
            phase('on', inner, finish, ['heating'])
        ];
        assert.equal(historyFold(stored, []).length, 1,
            'overlapping unsplit heatings stayed as two rows');
    });
});
