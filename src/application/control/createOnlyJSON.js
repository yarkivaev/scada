function encode(value) {
    return Buffer.from(value).toString('base64');
}

function decode(value) {
    return Buffer.from(value, 'base64').toString('utf8');
}

function rangeEnd(prefix) {
    const bytes = Buffer.from(prefix);
    let index = bytes.length - 1;
    while (index >= 0 && bytes[index] === 255) {
        index -= 1;
    }
    if (index < 0) {
        return encode(Buffer.of(0));
    }
    bytes[index] += 1;
    return encode(bytes.subarray(0, index + 1));
}

/** Stores the first JSON value written for each key under a caller-owned prefix. */
export default function createOnlyJSON(call, prefix) {
    if (typeof prefix !== 'string' || !prefix) {
        throw new TypeError('A nonempty key prefix is required');
    }
    const end = rangeEnd(prefix);
    return {
        async reserve(id, record) {
            const key = encode(`${prefix}${id}`);
            const body = await call('/v3/kv/txn', {
                compare: [{ key, target: 'VERSION', result: 'EQUAL', version: '0' }],
                success: [{ requestPut: { key, value: encode(JSON.stringify(record)) } }],
                failure: [{ requestRange: { key } }]
            });
            if (body.succeeded === true) {
                return { won: true, record };
            }
            const response = body.responses?.[0];
            const existing = (response?.response_range ?? response?.responseRange)?.kvs?.[0]?.value;
            return { won: false, record: existing ? JSON.parse(decode(existing)) : record };
        },
        async list() {
            const body = await call('/v3/kv/range', { key: encode(prefix), rangeEnd: end });
            return (body.kvs ?? []).map(({ key, value }) => {
                return { id: decode(key).slice(prefix.length), record: JSON.parse(decode(value)) };
            });
        }
    };
}
