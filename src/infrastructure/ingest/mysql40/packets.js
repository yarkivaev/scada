/**
 * Packet reader for the MySQL 4.0 wire protocol.
 *
 * One read is outstanding at a time. Callers sequence packets
 * with recursion instead of an await loop.
 *
 * @example
 *   const take = reader(socket);
 *   const body = await packet(take);
 */
import net from 'node:net';
import byteReader from './byteReader.js';

/**
 * Opens a TCP connection.
 *
 * @param {string} host - database host
 * @param {number} port - database port
 * @returns {Promise<import('node:net').Socket>} connected socket
 */
export function connect(host, port, { signal, timeoutMs = 10000 } = {}) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host, port });
        const timer = setTimeout(() => { socket.destroy(new Error('MySQL 4.0 connect timed out')); }, timeoutMs);
        function abort() { socket.destroy(signal.reason ?? new Error('MySQL 4.0 aborted')); }
        function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        socket.once('connect', () => { cleanup(); resolve(socket); });
        socket.once('error', (error) => { cleanup(); reject(error); });
        socket.once('close', () => { cleanup(); reject(new Error('MySQL 4.0 closed before connect')); });
        signal?.addEventListener('abort', abort, { once: true });
    });
}

/**
 * Frames a client packet.
 *
 * @param {number} seq - packet sequence
 * @param {Buffer} body - payload
 * @returns {Buffer} header plus body
 */
export function frame(seq, body) {
    const head = Buffer.from([
        body.length % 256,
        Math.floor(body.length / 256) % 256,
        Math.floor(body.length / 65536) % 256,
        seq
    ]);
    return Buffer.concat([head, body]);
}

/**
 * Creates a one-at-a-time byte reader.
 *
 * @param {import('node:net').Socket} socket - open socket
 * @returns {function(number): Promise<Buffer>} take(count)
 */
export function reader(socket, options = {}) {
    return byteReader(socket, options);
}

/**
 * Reads one length-prefixed packet.
 *
 * @param {function(number): Promise<Buffer>} take - byte reader
 * @returns {Promise<Buffer>} packet body
 */
export async function packet(take) {
    const head = await take(4);
    const length = head[0] + (head[1] * 256) + (head[2] * 65536);
    return take(length);
}
