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
        const folded = historyFold(stored, incoming);
        const crossed = folded.some((left, i) => {
            return folded.slice(i + 1).some((right) => {
                return Date.parse(left.start_time) < Date.parse(right.end_time)
                    && Date.parse(right.start_time) < Date.parse(left.end_time);
            });
        });
        assert.equal(crossed, false, 'a later stream opened a second heating over a tagged interval');
    });
    it('keeps the operator tag while a later stream extends heating', function () {
        const origin = 1_701_600_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const stored = [phase('on', start, stamp(origin, 20_000), ['нагрев-β'])];
        const incoming = [phase('on', stamp(origin, 8_000), stamp(origin, 40_000), [])];
        assert.equal(historyFold(stored, incoming)[0].tags, JSON.stringify(['нагрев-β']),
            'a later stream replaced the operator heating tag');
    });
    it('keeps later empty heating coverage after a tagged interval', function () {
        const origin = 1_701_700_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const finish = stamp(origin, 40_000);
        const stored = [phase('on', start, stamp(origin, 20_000), ['нагрев-γ'])];
        const incoming = [phase('on', stamp(origin, 8_000), finish, [])];
        const folded = historyFold(stored, incoming);
        const end = Math.max(...folded.map((row) => { return Date.parse(row.end_time); }));
        assert.equal(end, Date.parse(finish),
            'a later stream left uncovered time after a tagged heating');
    });
    it('does not move an internal split cut', function () {
        const origin = 1_701_800_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['этап_а-α'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['этап_б-α'], { split_of: key });
        const incoming = [phase('off', stamp(origin, 0), stamp(origin, 30_000), [])];
        const folded = historyFold([first, second], incoming);
        assert.equal(Date.parse(folded[1].start_time), origin + 10_000,
            'a later stream moved an operator split cut');
    });
    it('keeps split piece tags', function () {
        const origin = 1_701_900_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['этап_а-β'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['этап_б-β'], { split_of: key });
        const folded = historyFold([first, second], [phase('off', stamp(origin, 0), stamp(origin, 30_000), [])]);
        assert.deepEqual(folded.map((row) => { return row.tags; }),
            [JSON.stringify(['этап_а-β']), JSON.stringify(['этап_б-β'])],
            'a later stream replaced split piece tags');
    });
    it('extends only the last split piece', function () {
        const origin = 1_702_000_000_000 + Math.floor(Math.random() * 1e8);
        const key = String(origin);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['этап_а-γ'], { split_of: key });
        const second = phase('off', stamp(origin, 10_000), stamp(origin, 20_000), ['этап_б-γ'], { split_of: key });
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
    it('clips an empty covering off around a tagged split', function () {
        const origin = 1_702_200_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', stamp(origin, 0), stamp(origin, 15_000), []);
        const pour = phase('off', stamp(origin, 700), stamp(origin, 15_000), ['inspection'], { split_of: String(origin) });
        const folded = historyFold([cover], [pour]);
        const tagged = folded.find((row) => { return row.tags === JSON.stringify(['inspection']); });
        const start = Math.min(...folded.map((row) => { return Date.parse(row.start_time); }));
        assert.equal(Boolean(tagged) && start === origin, true,
            'an empty covering off stayed over a tagged ladle split');
    });
    it('treats empty tags and an empty array as the same tag', function () {
        const origin = 1_702_300_000_000 + Math.floor(Math.random() * 1e8);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), []);
        const second = { ...phase('off', stamp(origin, 4_000), stamp(origin, 12_000), []), tags: '[]' };
        assert.equal(historyFold([first], [second]).length, 1,
            'empty and [] offs stayed as two overlapping rows');
    });
    it('clips a heating that overlaps a later off', function () {
        const origin = 1_702_400_000_000 + Math.floor(Math.random() * 1e8);
        const heat = phase('on', stamp(origin, 0), stamp(origin, 20_000), ['heating']);
        const rest = phase('off', stamp(origin, 10_000), stamp(origin, 15_000), ['inspection']);
        const folded = historyFold([heat], [rest]);
        assert.equal(Date.parse(folded.find((row) => { return row.name === 'on'; }).end_time), origin + 10_000,
            'heating still overlapped the later off');
    });
    it('does not merge two unsplit offs that carry different tags', function () {
        const origin = 1_702_800_000_000 + Math.floor(Math.random() * 1e8);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['этап_а-δ']);
        const second = phase('off', stamp(origin, 4_000), stamp(origin, 12_000), ['этап_б-δ']);
        const folded = historyFold([first], [second]);
        const tags = folded.map((row) => { return row.tags; }).sort();
        assert.deepEqual(tags, [JSON.stringify(['этап_а-δ']), JSON.stringify(['этап_б-δ'])].sort(),
            'different tagged offs collapsed onto one row');
    });
    it('does not leave overlapping offs with different nonempty tags', function () {
        const origin = 1_702_810_000_000 + Math.floor(Math.random() * 1e8);
        const first = phase('off', stamp(origin, 0), stamp(origin, 10_000), ['этап_а-ε']);
        const second = phase('off', stamp(origin, 4_000), stamp(origin, 12_000), ['этап_б-ε']);
        const folded = historyFold([first], [second]);
        const crossed = folded.some((left, i) => {
            return folded.slice(i + 1).some((right) => {
                return Date.parse(left.start_time) < Date.parse(right.end_time)
                    && Date.parse(right.start_time) < Date.parse(left.end_time);
            });
        });
        assert.equal(crossed, false, 'different tagged offs still overlapped after fold');
    });
    it('keeps exclusive empty tails beside a nested tagged off', function () {
        const origin = 1_702_820_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', stamp(origin, 0), stamp(origin, 15_000), []);
        const tagged = phase('off', stamp(origin, 700), stamp(origin, 4_000), ['inspection']);
        const folded = historyFold([cover], [tagged]);
        const start = Math.min(...folded.map((row) => { return Date.parse(row.start_time); }));
        const finish = Math.max(...folded.map((row) => { return Date.parse(row.end_time); }));
        assert.equal(start === origin && finish === origin + 15_000, true,
            'clipping a tagged off dropped exclusive empty tails');
    });
    it('closes a live host when a completed continuation arrives', function () {
        const origin = 1_702_895_000_000 + Math.floor(Math.random() * 1e8);
        const start = stamp(origin, 0);
        const live = { ...phase('on', start, start, []), duration: 0, end_time: start };
        const closed = phase('on', start, stamp(origin, 20_000), []);
        const folded = historyFold([live], [closed]);
        assert.equal(folded[0].duration > 0, true, 'a completed continuation left the host live');
    });
    it('does not let a covered heartbeat reopen an off across a stored on', function () {
        const origin = 1_702_895_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', stamp(origin, 0), stamp(origin, 20_000), []);
        const heat = phase('on', stamp(origin, 5_000), stamp(origin, 8_000), []);
        const pulse = phase('off', stamp(origin, 0), stamp(origin, 0), []);
        pulse.duration = 0;
        const folded = historyFold([cover, heat], [pulse]);
        const crossed = folded.some((left, i) => {
            return folded.slice(i + 1).some((right) => {
                return left.name !== right.name
                    && Date.parse(left.start_time) < Date.parse(right.end_time)
                    && Date.parse(right.start_time) < Date.parse(left.end_time);
            });
        });
        assert.equal(crossed, false, 'a covered heartbeat still stretched off across a stored on');
    });
    it('clips an empty covering off around a later empty on', function () {
        const origin = 1_702_890_000_000 + Math.floor(Math.random() * 1e8);
        const cover = phase('off', stamp(origin, 0), stamp(origin, 20_000), []);
        const heat = phase('on', stamp(origin, 5_000), stamp(origin, 8_000), []);
        const folded = historyFold([cover], [heat]);
        const crossed = folded.some((left, i) => {
            return folded.slice(i + 1).some((right) => {
                return Date.parse(left.start_time) < Date.parse(right.end_time)
                    && Date.parse(right.start_time) < Date.parse(left.end_time);
            });
        });
        assert.equal(folded.some((row) => { return row.name === 'on'; }) && crossed === false, true,
            'an empty covering off still swallowed a later empty on');
    });
    it('does not drop a stored heating when a later empty off covers it', function () {
        const origin = 1_702_880_000_000 + Math.floor(Math.random() * 1e8);
        const heat = phase('on', stamp(origin, 1_000), stamp(origin, 5_000), ['heating']);
        const cover = phase('off', stamp(origin, 0), stamp(origin, 15_000), []);
        const folded = historyFold([heat], [cover]);
        assert.equal(folded.some((row) => { return row.name === 'on'; }), true,
            'a later empty off deleted a stored heating');
    });
    it('does not open a hole in off when heating overlaps it', function () {
        const origin = 1_702_830_000_000 + Math.floor(Math.random() * 1e8);
        const heat = phase('on', stamp(origin, 0), stamp(origin, 20_000), ['heating']);
        const rest = phase('off', stamp(origin, 10_000), stamp(origin, 15_000), ['inspection']);
        const folded = historyFold([heat], [rest]);
        const off = folded.find((row) => { return row.name === 'off'; });
        assert.equal(Date.parse(off.start_time) === origin + 10_000 && Date.parse(off.end_time) === origin + 15_000,
            true, 'overlapping heating punched a hole in off');
    });
});

describe('disjoint covering geometry', function () {
    it('does not merge a covering off into a distant earlier off', function () {
        const gap = 3 + Math.floor(Math.random() * 9);
        const start = Date.parse('2026-11-23T03:45:22.150Z');
        const closed = {
            machine: 'line-7',
            kind: 'phase',
            name: 'off',
            start_time: new Date(start).toISOString(),
            end_time: new Date(start + gap * 3600 * 1000).toISOString(),
            duration: gap * 3600,
            tags: '[]',
            properties: '{}'
        };
        const covering = {
            ...closed,
            start_time: new Date(start + (gap + 2) * 3600 * 1000).toISOString(),
            end_time: new Date(start + (gap + 8) * 3600 * 1000).toISOString(),
            duration: 0
        };
        assert.equal(
            historyFold([closed], [covering]).length,
            2,
            'covering still swallowed the distant idle off'
        );
    });
});
