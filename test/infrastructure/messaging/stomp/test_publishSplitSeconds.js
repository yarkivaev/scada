import assert from 'assert';
import net from 'net';
import userDecisions from '../../../../src/infrastructure/messaging/stomp/userDecisions.js';

function takeFrame(buffer) {
    const nul = buffer.indexOf(0);
    if (nul < 0) {
        return null;
    }
    const raw = buffer.slice(0, nul).toString('utf8').replace(/^\n+/u, '');
    const rest = buffer.slice(nul + 1);
    if (!raw) {
        return { command: 'HEARTBEAT', headers: {}, body: '', rest };
    }
    const lines = raw.split('\n');
    const headers = {};
    let index = 1;
    for (; index < lines.length; index += 1) {
        if (lines[index] === '') {
            index += 1;
            break;
        }
        const cut = lines[index].indexOf(':');
        headers[lines[index].slice(0, cut)] = lines[index].slice(cut + 1);
    }
    return { command: lines[0].trim(), headers, body: lines.slice(index).join('\n'), rest };
}

function reply(socket, frame) {
    if (frame.command === 'CONNECT' || frame.command === 'STOMP') {
        socket.write('CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0');
        return;
    }
    if (frame.command === 'DISCONNECT' && frame.headers.receipt !== undefined) {
        socket.write(`RECEIPT\nreceipt-id:${frame.headers.receipt}\n\n\0`);
    }
}

function listen() {
    const bodies = [];
    const server = net.createServer((socket) => {
        let pending = Buffer.alloc(0);
        socket.on('data', (chunk) => {
            pending = Buffer.concat([pending, chunk]);
            let frame = takeFrame(pending);
            while (frame) {
                pending = frame.rest;
                if (frame.command === 'SEND') {
                    bodies.push(frame.body);
                }
                reply(socket, frame);
                frame = takeFrame(pending);
            }
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ port: server.address().port, bodies, server });
        });
    });
}

describe('publishSplit wire time', function() {
    it('sends split start and end as epoch seconds', async function() {
        const broker = await listen();
        const start = new Date('2026-10-19T06:02:18.137Z');
        const cut = new Date(start.getTime() + 120000);
        const end = new Date(start.getTime() + 360000);
        try {
            const decisions = userDecisions({ stompUrl: `stomp://127.0.0.1:${broker.port}` });
            await decisions.publishSplit('ичт-π', start, [
                { start, end: cut, tag: 'шлак' },
                { start: cut, end, tag: '', open: true }
            ], { displayName: 'Елена', id: 7, decidedAt: new Date('2026-10-19T08:00:00.137Z') });
            const body = JSON.parse(broker.bodies[0]);
            assert.deepStrictEqual(body.splits.map((piece) => {
                return [piece.start, piece.end];
            }), [
                [start.getTime() / 1000, cut.getTime() / 1000],
                [cut.getTime() / 1000, end.getTime() / 1000]
            ], 'publishSplit sent piece bounds in milliseconds');
        } finally {
            broker.server.close();
        }
    });
});
