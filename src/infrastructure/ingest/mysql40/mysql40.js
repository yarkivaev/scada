/**
 * Read-only client for MySQL 4.0.
 *
 * Older servers can close connections that send a 4.1 handshake.
 *
 * @example
 *   const db = mysql40({ host: '127.0.0.1', port: 3306, user: 'reader', password: 'secret', database: 'monitoring' });
 *   await db.query('SELECT 1');
 */
import scramble from './scramble.js';
import resultRows from './resultRows.js';
import { connect, frame, packet, reader } from './packets.js';

/**
 * Client auth packet for protocol 4.0.
 *
 * @param {Buffer} salt - 8-byte scramble
 * @param {object} options - user, password, database
 * @returns {Buffer} handshake response
 */
function login(salt, options) {
    const scrambled = scramble(salt, Buffer.from(options.password));
    return Buffer.concat([
        Buffer.from([0x0d, 0x20, 0xff, 0xff, 0xff]),
        Buffer.from(`${options.user}\0`),
        scrambled,
        Buffer.from(`\0${options.database}\0`)
    ]);
}

/**
 * Salt from a protocol-10 greeting.
 *
 * @param {Buffer} greeting - server greeting
 * @returns {Buffer} 8-byte salt
 */
function saltOf(greeting) {
    const end = greeting.indexOf(0, 1);
    return greeting.subarray(end + 5, end + 13);
}

/**
 * Collects packets until a short 0xfe marker, then one past it is not included.
 *
 * @param {function(number): Promise<Buffer>} take - byte reader
 * @param {Buffer[]} found - packets so far
 * @param {number} eofs - short 0xfe packets seen
 * @returns {Promise<Buffer[]>} result packets
 */
async function gather(take, limits) {
    const found = [];
    let eofs = 0;
    let bytes = 0;
    while (eofs < 2) {
        // Packet order is defined by the MySQL wire protocol.
        // eslint-disable-next-line no-await-in-loop
        const body = await packet(take);
        bytes += body.length;
        if (found.length >= limits.maxPackets || bytes > limits.maxResponseBytes) { throw new Error('MySQL 4.0 response capacity exceeded'); }
        if (body[0] === 255) { throw new Error(`MySQL 4.0 query failed ${body.toString('latin1', 3)}`); }
        if (body.length < 9 && body[0] === 254) { eofs += 1; }
        found.push(body);
    }
    return found;
}

/**
 * Authenticates and runs one SELECT.
 *
 * @param {import('node:net').Socket} socket - connected socket
 * @param {object} options - login options
 * @param {string} sql - SELECT statement
 * @returns {Promise<Array<object>>} rows
 */
async function ask(socket, options, sql) {
    const take = reader(socket, options);
    const greeting = await packet(take);
    socket.write(frame(1, login(saltOf(greeting), options)));
    const reply = await packet(take);
    if (reply[0] === 255) {
        throw new Error(`MySQL 4.0 login failed ${reply.toString('latin1', 3)}`);
    }
    socket.write(frame(0, Buffer.concat([Buffer.from([3]), Buffer.from(sql)])));
    return resultRows(await gather(take, options));
}

/**
 * Opens a short-lived read-only session per query.
 *
 * @param {{ host: string, port: number, user: string, password: string, database: string }} options - connection
 * @returns {{ query: function(string): Promise<Array<object>> }} client
 */
export default function mysql40(config) {
    const options = { maxPackets: 10000, maxResponseBytes: 1048576, ...config };
    if (![options.maxPackets, options.maxResponseBytes].every((value) => { return Number.isSafeInteger(value) && value > 0; })) {
        throw new TypeError('Invalid MySQL 4.0 response limits');
    }
    return {
        async query(sql) {
            if (!sql.startsWith('SELECT ')) {
                throw new Error(`MySQL 4.0 query is not a read ${sql.slice(0, 24)}`);
            }
            options.signal?.throwIfAborted();
            const socket = await connect(options.host, options.port, options);
            function abort() { socket.destroy(new Error('MySQL 4.0 aborted')); }
            options.signal?.addEventListener('abort', abort, { once: true });
            try {
                options.signal?.throwIfAborted();
                return await ask(socket, options, sql);
            } finally {
                options.signal?.removeEventListener('abort', abort);
                socket.destroy();
            }
        }
    };
}
