function encoded(value) {
    return Buffer.from(value).toString('base64');
}

function put(key, value) {
    return { key: encoded(key), value: encoded(JSON.stringify(value)) };
}

/** Writes independent application records under a caller-owned assignment prefix. */
export default function jsonAssignments(call, prefix) {
    function key(id) {
        return `${prefix.replace(/\/$/u, '')}/assignments/${id}`;
    }
    return {
        write(id, value) {
            return call('/v3/kv/put', put(key(id), value));
        },
        async compareAndSet(id, revision, value) {
            const path = key(id);
            const version = revision ? { target: 'MOD', 'mod_revision': String(revision) }
                : { target: 'VERSION', version: '0' };
            const result = await call('/v3/kv/txn', {
                compare: [{ key: encoded(path), result: 'EQUAL', ...version }],
                success: [{ 'request_put': put(path, value) }],
                failure: []
            });
            return result?.succeeded === true;
        }
    };
}
