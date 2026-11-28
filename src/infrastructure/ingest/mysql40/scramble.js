/**
 * MySQL 4.0 old-password scramble.
 *
 * The mix matches the server's 32-bit unsigned arithmetic.
 *
 * @example
 *   scramble(Buffer.from('12345678'), Buffer.from('secret'));
 */

/**
 * Keeps a value inside unsigned 32 bits.
 *
 * @param {number} value - intermediate mix
 * @returns {number} unsigned 32-bit value
 */
function mask(value) {
    const wrapped = value % 4294967296;
    return wrapped < 0 ? wrapped + 4294967296 : wrapped;
}

/**
 * Xors two unsigned 32-bit values without bitwise operators.
 *
 * @param {number} left - first value
 * @param {number} right - second value
 * @returns {number} xor
 */
function xor(left, right) {
    let out = 0;
    let bit = 1;
    let low = mask(left);
    let high = mask(right);
    for (let i = 0; i < 32; i += 1) {
        if ((low % 2) !== (high % 2)) {
            out += bit;
        }
        low = Math.floor(low / 2);
        high = Math.floor(high / 2);
        bit *= 2;
    }
    return out;
}

/**
 * Hashes a password or salt the way MySQL 4.0 does.
 *
 * @param {Buffer} password - raw bytes, spaces skipped
 * @returns {number[]} two masked halves
 */
function mix(password) {
    let nr = 1345345333;
    let add = 7;
    let nr2 = 305419889;
    for (const byte of password) {
        if (byte !== 32 && byte !== 9) {
            const mixed = mask((((nr % 64) + add) * byte) + mask(nr * 256));
            nr = xor(nr, mixed);
            nr2 = mask(nr2 + xor(mask(nr2 * 256), nr));
            add += byte;
        }
    }
    return [nr % 2147483648, nr2 % 2147483648];
}

/**
 * Scrambles an 8-byte salt with the account password.
 *
 * @param {Buffer} message - server salt
 * @param {Buffer} password - account password
 * @returns {Buffer} 8-byte reply
 */
export default function scramble(message, password) {
    const pass = mix(password);
    const salt = mix(message);
    let seed1 = xor(pass[0], salt[0]) % 1073741824;
    let seed2 = xor(pass[1], salt[1]) % 1073741824;
    const out = [];
    const span = 1073741823;
    for (let i = 0; i < message.length; i += 1) {
        seed1 = ((seed1 * 3) + seed2) % span;
        seed2 = (seed1 + seed2 + 33) % span;
        out.push(Math.floor((seed1 / span) * 31) + 64);
    }
    seed1 = ((seed1 * 3) + seed2) % span;
    const extra = Math.floor((seed1 / span) * 31);
    return Buffer.from(out.map((item) => {
        return xor(item, extra);
    }));
}
