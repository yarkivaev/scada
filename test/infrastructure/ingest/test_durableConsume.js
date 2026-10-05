import { EventEmitter } from 'node:events';
import assert from 'node:assert';
import durableConsume from '../../../src/infrastructure/ingest/durableConsume.js';

function link() {
    const connection = new EventEmitter();
    const channel = new EventEmitter();
    connection.createChannel = async () => {
        return channel;
    };
    connection.close = async () => {};
    channel.cancel = async () => {};
    channel.close = async () => {};
    return { connection, channel };
}

function harness(links, pending) {
    const url = `amqp://узел-${Math.random().toString(36).slice(2)}`;
    return durableConsume(url, async () => {
        return `tag-${links.length}`;
    }, {
        async connect() {
            const item = link();
            links.push(item);
            return item.connection;
        },
        schedule(fn) {
            pending.push(fn);
            return pending.length;
        },
        clear() {},
        report() {}
    });
}

describe('durableConsume', function() {
    it('subscribes again after the broker closes the connection', async function() {
        const links = [];
        const pending = [];
        const session = harness(links, pending);
        await session.start();
        links[0].connection.emit('close');
        await pending[0]();
        assert.strictEqual(
            links.length,
            2,
            'broker close did not open a second AMQP connection'
        );
    });

    it('schedules one reconnect when error and close both fire', async function() {
        const links = [];
        const pending = [];
        const session = harness(links, pending);
        await session.start();
        links[0].connection.emit('error', new Error(`сбой-${Math.random().toString(36).slice(2)}`));
        links[0].connection.emit('close');
        assert.strictEqual(pending.length, 1, 'error and close scheduled two reconnects');
    });

    it('does not reconnect after stop', async function() {
        const links = [];
        const pending = [];
        const session = harness(links, pending);
        await session.start();
        await session.stop();
        links[0].connection.emit('close');
        assert.strictEqual(pending.length, 0, 'stop left a reconnect scheduled');
    });

    it('schedules a retry when the first connect fails', async function() {
        const pending = [];
        const url = `amqp://отказ-${Math.random().toString(36).slice(2)}`;
        const session = durableConsume(url, async () => {
            return 'tag';
        }, {
            async connect() {
                throw new Error(`нет брокера ${url}`);
            },
            schedule(fn) {
                pending.push(fn);
                return pending.length;
            },
            report() {}
        });
        await session.start();
        assert.strictEqual(pending.length, 1, 'failed connect did not schedule a retry');
    });
});
