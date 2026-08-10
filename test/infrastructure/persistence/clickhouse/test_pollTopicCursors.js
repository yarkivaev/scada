import assert from 'assert';
import pollTopicCursors from '../../../../src/infrastructure/persistence/clickhouse/pollTopicCursors.js';

describe('pollTopicCursors', function() {
    it('issues one query for many topics', async function() {
        const topicA = `COOLING/m-${Math.random()}/GET/T01/VALUE`;
        const topicB = `MX210/m-${Math.random()}/GET/AI1/VALUE`;
        let queries = 0;
        const connection = {
            async query() {
                queries += 1;
                return [];
            }
        };
        await pollTopicCursors(
            connection,
            [
                { topic: topicA, since: new Date('2024-06-01T10:00:00.000Z') },
                { topic: topicB, since: new Date('2024-06-01T10:00:00.000Z') }
            ],
            new Date('2024-06-01T10:00:01.000Z')
        );
        assert.strictEqual(queries, 1, 'batched poll issued more than one ClickHouse query');
    });

    it('passes all topics in one IN parameter', async function() {
        const topics = Array.from({ length: 17 }, () => {
            return `sensor/${Math.random()}`;
        });
        let seen = [];
        const connection = {
            async query(sql, params) {
                seen = params.topics;
                return [];
            }
        };
        await pollTopicCursors(
            connection,
            topics.map((topic) => {
                return { topic, since: new Date('2024-06-01T10:00:00.000Z') };
            }),
            new Date('2024-06-01T10:00:01.000Z')
        );
        assert.deepStrictEqual(seen, topics, 'IN topics did not match watcher topics');
    });

    it('returns rows from the single batch query', async function() {
        const topic = `T/${Math.random()}`;
        const connection = {
            async query() {
                return [{ topic, ts: '2024-06-01 10:00:00.500', value: 42.5 }];
            }
        };
        const rows = await pollTopicCursors(
            connection,
            [{ topic, since: new Date('2024-06-01T10:00:00.000Z') }],
            new Date('2024-06-01T10:00:01.000Z')
        );
        assert.strictEqual(rows[0].value, 42.5, 'batch poll did not return query rows');
    });

    it('keeps query count equal to pulse count for large topic sets', async function() {
        const topics = Array.from({ length: 60 }, () => {
            return `load/${Math.random()}`;
        });
        let queries = 0;
        const connection = {
            async query() {
                queries += 1;
                return [];
            }
        };
        const cursors = topics.map((topic) => {
            return { topic, since: new Date('2024-06-01T10:00:00.000Z') };
        });
        const until = new Date('2024-06-01T10:00:01.000Z');
        await pollTopicCursors(connection, cursors, until);
        await pollTopicCursors(connection, cursors, until);
        await pollTopicCursors(connection, cursors, until);
        assert.strictEqual(
            queries,
            3,
            'CPU budget exceeded: queries grew with topics instead of pulses'
        );
    });
});
