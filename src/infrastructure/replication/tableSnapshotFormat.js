import { canonicalJSON, jsonDigest } from './canonicalJSON.js';

export const tableSnapshotLimit = 64 * 1024 * 1024;

function compareRows(first, second) {
    const before = canonicalJSON(first);
    const after = canonicalJSON(second);
    if (before < after) { return -1; }
    if (before > after) { return 1; }
    return 0;
}

function fail() { throw new Error('Table snapshot is invalid or incompatible'); }

function tableSet(value, names, sortedNames) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || canonicalJSON(Object.keys(value).sort()) !== sortedNames) { fail(); }
    if (names.some((table) => { return !Array.isArray(value[table]); })) { fail(); }
}

function schemaValid(schema, sortedNames) {
    if (!Array.isArray(schema)
        || canonicalJSON(schema.map((item) => { return item?.table; }).sort()) !== sortedNames) { fail(); }
    if (schema.some((item) => { return !Array.isArray(item.columns) || !item.columns.length
        || item.columns.some((column) => { return typeof column?.name !== 'string' || typeof column.type !== 'string'
            || typeof column.nullable !== 'boolean'; }); })) { fail(); }
}

/** Sorts opaque table rows and hashes the content independently of the export timestamp. */
export function tableSnapshotFormat({ tables: names, format, metadata = () => { return {}; } }) {
    const sortedNames = canonicalJSON([...names].sort());
    function seal({ schema, tables, createdAt = new Date().toISOString() }) {
        tableSet(tables, names, sortedNames);
        schemaValid(schema, sortedNames);
        if (!Number.isFinite(Date.parse(createdAt))) { fail(); }
        const sorted = Object.fromEntries(names.map((name) => {
            return [name, [...tables[name]].sort(compareRows)];
        }));
        const content = { ...metadata(sorted), format, schemaHash: jsonDigest(schema), tables: sorted };
        return { ...content, schema, createdAt, hash: jsonDigest(content) };
    }
    function validate(value, { maxBytes = tableSnapshotLimit } = {}) {
        if (!value || Buffer.byteLength(JSON.stringify(value)) > maxBytes) { fail(); }
        const expected = seal(value);
        const fields = Object.keys(expected).filter((key) => { return !['schema', 'createdAt', 'tables'].includes(key); });
        if (fields.some((key) => { return canonicalJSON(value[key]) !== canonicalJSON(expected[key]); })) { fail(); }
        return expected;
    }
    return { seal, validate };
}
