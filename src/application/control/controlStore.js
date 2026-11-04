import { randomUUID } from 'node:crypto';
import validateCatalog from './catalog.js';
function encoded(value) { return Buffer.from(value).toString('base64'); }
function decoded(value) { return Buffer.from(value, 'base64').toString(); }
function put(key, value, lease) { return { request_put: { key: encoded(key), value: encoded(JSON.stringify(value)), ...(lease && { lease }) } }; }
function revision(key, value) { return { key: encoded(key), target: 'MOD', result: 'EQUAL', mod_revision: String(value) }; }
export default function controlStore(call, prefix = '/scada/control') {
    const root = prefix.replace(/\/$/u, '');
    const lock = `${root}/leader`;
    const session = randomUUID();
    async function range(key) { const result = await call('/v3/kv/range', { key: encoded(key) }); return result.kvs?.[0] ?? null; }
    return {
        async acquire() {
            const grant = await call('/v3/lease/grant', { TTL: '15' });
            const previous = await range(lock);
            const own = previous && decoded(previous.value) === JSON.stringify(session);
            const compare = own ? revision(lock, previous.mod_revision) : { key: encoded(lock), target: 'VERSION', result: 'EQUAL', version: '0' };
            const result = await call('/v3/kv/txn', { compare: [compare], success: [put(lock, session, grant.ID)], failure: [] });
            return result.succeeded ? { session, lease: grant.ID } : null;
        },
        async read() {
            const result = await call('/v3/kv/range', { key: encoded(`${root}/`), range_end: encoded(`${root}0`) });
            const view = { catalog: null, reports: [], assignments: {}, revisions: {} };
            for (const row of result.kvs ?? []) {
                const key = decoded(row.key).slice(root.length + 1);
                const value = JSON.parse(decoded(row.value));
                view.revisions[key] = row.mod_revision;
                if (key === 'catalog') { view.catalog = value; }
                if (key.startsWith('reports/')) { view.reports.push(value); }
                if (key.startsWith('assignments/')) { view.assignments[key.slice(12)] = value; }
            }
            return view;
        },
        async commit(token, view, assignments) {
            const compare = [{ key: encoded(lock), target: 'VALUE', result: 'EQUAL', value: encoded(JSON.stringify(token.session)) },
                { key: encoded(lock), target: 'LEASE', result: 'EQUAL', lease: token.lease },
                ...Object.entries(view.revisions).filter(([key]) => { return key !== 'leader'; }).map(([key, value]) => { return revision(`${root}/${key}`, value); })];
            const changes = Object.entries(assignments).filter(([id, value]) => { return JSON.stringify(value) !== JSON.stringify(view.assignments[id]); });
            if (!changes.length) { return true; }
            const result = await call('/v3/kv/txn', { compare, success: changes.map(([id, value]) => { return put(`${root}/assignments/${id}`, value); }), failure: [] });
            return Boolean(result.succeeded);
        },
        async assignment(id) { const row = await range(`${root}/assignments/${id}`); return row ? JSON.parse(decoded(row.value)) : null; },
        report(id, value) { return call('/v3/kv/put', put(`${root}/reports/${id}`, value).request_put); },
        async publish(catalog, expectedRevision) {
            validateCatalog(catalog);
            const key = `${root}/catalog`;
            const existing = await range(key);
            const expected = expectedRevision ?? existing?.mod_revision ?? '0';
            const result = await call('/v3/kv/txn', { compare: [revision(key, expected)], success: [put(key, catalog)], failure: [] });
            if (!result.succeeded) { throw new Error('Catalog publication conflict'); }
            return { accepted: true, revision: result.header.revision, catalogVersion: catalog.version };
        }
    };
}
