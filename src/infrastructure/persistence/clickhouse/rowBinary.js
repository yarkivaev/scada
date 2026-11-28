export function micros(value) {
    if (value instanceof Date) { return BigInt(value.getTime()) * 1000n; }
    if (typeof value === 'number') { return micros(new Date(value)); }
    const match = /^(?<date>\d{4}-\d{2}-\d{2})[ T](?<time>\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d{1,6}))?(?:Z|\+00(?::?00)?)?$/u.exec(value);
    if (!match) { throw new Error('Telemetry timestamp requires exact UTC microseconds'); }
    const { date, time, fraction = '' } = match.groups;
    const decimal = fraction.padEnd(6, '0');
    return BigInt(Date.parse(`${date}T${time}.${decimal.slice(0, 3)}Z`)) * 1000n + BigInt(decimal.slice(3));
}

function prefix(length) {
    const bytes = [];
    let remaining = length;
    do {
        const digit = remaining % 128;
        remaining = Math.floor(remaining / 128);
        bytes.push(digit + (remaining ? 128 : 0));
    } while (remaining);
    return Buffer.from(bytes);
}

function record(row) {
    if (!Number.isFinite(row.value)) { throw new Error(`Finite telemetry value required for topic ${row.topic}`); }
    const topic = Buffer.from(row.topic, 'utf8');
    const length = prefix(topic.length);
    const offset = length.length + topic.length;
    const buffer = Buffer.alloc(offset + 16);
    length.copy(buffer);
    topic.copy(buffer, length.length);
    buffer.writeBigInt64LE(micros(row.ts), offset);
    buffer.writeDoubleLE(row.value, offset + 8);
    return buffer;
}

/** Encodes the fixed metrics schema as UTF8 String, UTC DateTime64(6), and exact IEEE754 Float64 bytes. */
export default function rowBinary(rows) {
    return Buffer.concat(rows.map(record));
}
