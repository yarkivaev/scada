import { canonicalJSON } from './canonicalJSON.js';

function identifier(name) {
    if (typeof name !== 'string' || !name || name.includes('\0')) { throw new Error('Invalid PostgreSQL identifier'); }
    return `"${name.replaceAll('"', '""')}"`;
}

async function transaction(pool, begin, operation) {
    const client = await pool.connect();
    try {
        await client.query(begin);
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => { return undefined; });
        throw error;
    } finally { client.release(); }
}

function validateRows(snapshot) {
    snapshot.schema.forEach(({ table, columns }) => {
        const keys = canonicalJSON(columns.map((column) => { return column.name; }).sort());
        if (snapshot.tables[table].some((row) => { return !row || canonicalJSON(Object.keys(row).sort()) !== keys; })) {
            throw new Error('Snapshot columns do not match');
        }
    });
}

async function schemaFor(client, namespace, tables) {
    const result = await client.query(`SELECT c.relname AS "table", a.attname AS name,
      pg_catalog.format_type(a.atttypid,a.atttypmod) AS type, NOT a.attnotnull AS nullable
      FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname,a.attnum`, [namespace, tables]);
    return [...tables].sort().map((table) => {
        return { table, columns: result.rows.filter((row) => { return row.table === table; })
            .map(({ name, type, nullable }) => { return { name, type, nullable }; }) };
    });
}

function checkpointStatements(table) {
    return {
        latest: `SELECT hash,exported_at AS "exportedAt",imported_at AS "importedAt" FROM ${table} WHERE id=1`,
        ensure: `CREATE TABLE IF NOT EXISTS ${table}
          (id integer PRIMARY KEY CHECK(id=1), hash text NOT NULL, exported_at timestamptz NOT NULL, imported_at timestamptz NOT NULL)`,
        save: `INSERT INTO ${table} (id,hash,exported_at,imported_at)
          VALUES (1,$1,$2,clock_timestamp()) ON CONFLICT(id) DO UPDATE
          SET hash=EXCLUDED.hash,exported_at=EXCLUDED.exported_at,imported_at=EXCLUDED.imported_at
          RETURNING hash,exported_at AS "exportedAt",imported_at AS "importedAt"`
    };
}

function tableReader(client, qualified) {
    return async (table) => {
        if (!qualified.has(table)) { throw new Error('Table outside snapshot schema'); }
        const result = await client.query(`SELECT row_to_json(row) AS value FROM ${qualified.get(table)} row`);
        return result.rows.map((row) => { return row.value; });
    };
}

async function replaceRows(client, snapshot, qualified, { cascade, disableTriggers }) {
    if (disableTriggers) { await client.query('SET LOCAL session_replication_role=replica'); }
    await client.query(`TRUNCATE ${[...qualified.values()].join(',')}${cascade ? ' CASCADE' : ''}`);
    for (const [name, table] of qualified) {
        // Insert in catalog order because later tables can reference earlier tables.
        // eslint-disable-next-line no-await-in-loop
        await client.query(`INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, $1::json)`,
            [JSON.stringify(snapshot.tables[name])]);
    }
}

/** Replicate an explicit table catalog and atomically record its checkpoint in PostgreSQL. */
export function postgresSnapshotReplica({
    namespace = 'public', tables, format, checkpoint, lock, compatible, cascade = false, disableTriggers = false
}) {
    function qualify(name) { return `${identifier(namespace)}.${identifier(name)}`; }
    if (tables.includes(checkpoint)) { throw new Error('Checkpoint table must be outside snapshot schema'); }
    const qualified = new Map(tables.map((name) => { return [name, qualify(name)]; }));
    const state = checkpointStatements(qualify(checkpoint));
    function schema(client) { return schemaFor(client, namespace, tables); }

    function exportSnapshot(pool) {
        return transaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async (client) => {
            await client.query("SET LOCAL TIME ZONE 'UTC'");
            await client.query("SET LOCAL bytea_output='hex'");
            const localSchema = await schema(client);
            const read = tableReader(client, qualified);
            const rows = [];
            for (const name of tables) {
                // The transaction's PostgreSQL client supports one query at a time.
                // eslint-disable-next-line no-await-in-loop
                rows.push([name, await read(name)]);
            }
            return format.seal({ schema: localSchema, tables: Object.fromEntries(rows) });
        });
    }

    function importSnapshot(pool, input) {
        const snapshot = format.validate(input);
        validateRows(snapshot);
        return transaction(pool, 'BEGIN', async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
            if (canonicalJSON(await schema(client)) !== canonicalJSON(snapshot.schema)
                || compatible && !await compatible(snapshot, tableReader(client, qualified))) {
                throw new Error('Snapshot does not match the local PostgreSQL schema or identity');
            }
            await client.query(state.ensure);
            const previous = await client.query(state.latest);
            if (previous.rows[0]?.hash !== snapshot.hash) {
                await replaceRows(client, snapshot, qualified, { cascade, disableTriggers });
            }
            const result = await client.query(state.save, [snapshot.hash, snapshot.createdAt]);
            return result.rows[0];
        });
    }

    async function checkpointFor(pool) {
        const result = await transaction(pool, 'BEGIN', async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock]);
            await client.query(state.ensure);
            return client.query(state.latest);
        });
        return result.rows[0] || null;
    }

    return { schema, exportSnapshot, importSnapshot, checkpointFor };
}
