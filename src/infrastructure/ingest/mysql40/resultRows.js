/**
 * Parses a MySQL 4.0 text result set.
 *
 * Field names are the second length-coded string. Rows are length-coded
 * strings, and a short 0xfe packet ends the fields and the rows.
 *
 * @example
 *   resultRows([Buffer.from([1]), namePacket, Buffer.from([0xfe])]);
 */

/**
 * Reads a length-coded integer.
 *
 * @param {Buffer} buf - packet
 * @param {number} index - offset
 * @returns {{ value: number|null, index: number }} decoded value
 */
function lenenc(buf, index) {
    const head = buf[index];
    if (head < 251) {
        return { value: head, index: index + 1 };
    }
    if (head === 251) {
        return { value: null, index: index + 1 };
    }
    if (head === 252) {
        return { value: buf[index + 1] + (buf[index + 2] * 256), index: index + 3 };
    }
    const wide = buf[index + 1] + (buf[index + 2] * 256) + (buf[index + 3] * 65536);
    return { value: wide, index: index + 4 };
}

/**
 * Reads a length-coded string as raw Latin-1 bytes.
 *
 * @param {Buffer} buf - packet
 * @param {number} index - offset
 * @returns {{ value: string|null, index: number }} decoded text
 */
function text(buf, index) {
    const size = lenenc(buf, index);
    if (size.value === null) {
        return { value: null, index: size.index };
    }
    const end = size.index + size.value;
    return { value: buf.toString('latin1', size.index, end), index: end };
}

/**
 * Field name from a 4.0 column packet.
 *
 * @param {Buffer} packet - column definition
 * @returns {string} column name
 */
function fieldName(packet) {
    const table = text(packet, 0);
    return text(packet, table.index).value;
}

/**
 * Whether a packet is the end-of-fields or end-of-rows marker.
 *
 * @param {Buffer} packet - protocol packet
 * @returns {boolean} true for a short 0xfe packet
 */
function eof(packet) {
    return packet.length < 9 && packet[0] === 254;
}

/**
 * Splits packets into column names and row objects.
 *
 * @param {Buffer[]} packets - result packets, field count first
 * @returns {Array<object>} rows
 */
export default function resultRows(packets) {
    const head = packets[0];
    if (head[0] === 255) {
        throw new Error(`MySQL 4.0 query failed ${head.toString('latin1', 3)}`);
    }
    const count = head[0];
    const names = packets.slice(1, 1 + count).map(fieldName);
    const body = packets.slice(2 + count);
    return body.filter((packet) => {
        return !eof(packet);
    }).map((packet) => {
        return names.reduce((row, name) => {
            const cell = text(packet, row.index);
            return { index: cell.index, values: { ...row.values, [name]: cell.value } };
        }, { index: 0, values: {} }).values;
    });
}
