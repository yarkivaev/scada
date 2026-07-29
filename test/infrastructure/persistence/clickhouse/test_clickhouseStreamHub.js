import assert from 'assert';
import { createClickhouseStreamHub } from '../../../../src/infrastructure/persistence/clickhouse/streamHub.js';

describe('clickhouseStreamHub', function() {
    it('coalesces many watches into one query per pulse', async function() {
        let queries = 0;
        const connection = {
            url() {
                return 'http://hub-coalesce';
            },
            async query() {
                queries += 1;
                return [];
            }
        };
        const pulses = [];
        const schedule = (step, fn) => {
            pulses.push(fn);
            return () => {
                return undefined;
            };
        };
        const hub = createClickhouseStreamHub(connection, schedule);
        const since = new Date('2024-06-01T10:00:00.000Z');
        const clock = () => {
            return new Date('2024-06-01T10:00:01.000Z');
        };
        const count = 48;
        const subs = [];
        for (let i = 0; i < count; i += 1) {
            subs.push(hub.watch(`topic-${i}-${Math.random()}`, since, 1000, () => {
                return undefined;
            }, { unit: 'V', clock }));
        }
        await pulses[0]();
        subs.forEach((sub) => {
            sub.cancel();
        });
        assert.strictEqual(queries, 1, 'hub pulse ran one query per topic instead of one batch');
    });

    it('keeps queries proportional to pulses not to sensor count', async function() {
        let queries = 0;
        const connection = {
            url() {
                return 'http://hub-budget';
            },
            async query() {
                queries += 1;
                return [];
            }
        };
        const pulses = [];
        const schedule = (step, fn) => {
            pulses.push(fn);
            return () => {
                return undefined;
            };
        };
        const hub = createClickhouseStreamHub(connection, schedule);
        const since = new Date('2024-06-01T10:00:00.000Z');
        let now = new Date('2024-06-01T10:00:01.000Z');
        const clock = () => {
            return now;
        };
        const subs = Array.from({ length: 60 }, (unused, i) => {
            return hub.watch(`cpu-${i}-${Math.random()}`, since, 1000, () => {
                return undefined;
            }, { unit: 'V', clock });
        });
        await pulses[0]();
        now = new Date('2024-06-01T10:00:02.000Z');
        await pulses[0]();
        now = new Date('2024-06-01T10:00:03.000Z');
        await pulses[0]();
        now = new Date('2024-06-01T10:00:04.000Z');
        await pulses[0]();
        now = new Date('2024-06-01T10:00:05.000Z');
        await pulses[0]();
        subs.forEach((sub) => {
            sub.cancel();
        });
        assert.strictEqual(queries, 5, 'CPU not optimal: query count grew with sensors instead of pulses');
    });

    it('delivers batch rows to the matching topic callback', async function() {
        const topic = `deliver/${Math.random()}`;
        const connection = {
            url() {
                return 'http://hub-deliver';
            },
            async query() {
                return [{ topic, ts: '2024-06-01 10:00:00.250', value: 7.25 }];
            }
        };
        const pulses = [];
        const schedule = (step, fn) => {
            pulses.push(fn);
            return () => {
                return undefined;
            };
        };
        const hub = createClickhouseStreamHub(connection, schedule);
        let got = 0;
        const sub = hub.watch(
            topic,
            new Date('2024-06-01T10:00:00.000Z'),
            1000,
            (item) => {
                got = item.value;
            },
            {
                unit: 'A',
                clock: () => {
                    return new Date('2024-06-01T10:00:01.000Z');
                }
            }
        );
        await pulses[0]();
        sub.cancel();
        assert.strictEqual(got, 7.25, 'callback did not receive batched row value');
    });
});
