const statements = [
    'CREATE TABLE counters (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, records INTEGER NOT NULL, sequence INTEGER NOT NULL)',
    'CREATE TABLE destinations (id TEXT PRIMARY KEY, json TEXT NOT NULL, refs INTEGER NOT NULL)',
    `CREATE TABLE events (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload BLOB NOT NULL,
 destinations TEXT, recipients TEXT NOT NULL, remaining TEXT NOT NULL, bytes INTEGER NOT NULL, sequence INTEGER NOT NULL)`,
    'CREATE INDEX event_sequence ON events(sequence)',
    'CREATE TABLE imports (name TEXT PRIMARY KEY, digest TEXT NOT NULL, event_id TEXT NOT NULL)'
];
function metadata(db) {
    return db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 6").all();
}
function validCounters(db) {
    const rows = db.prepare('SELECT id,bytes,records,sequence FROM counters LIMIT 2').all();
    const row = rows[0];
    return rows.length === 1 && row.id === 1
        && [row.bytes, row.records, row.sequence].every((value) => { return Number.isSafeInteger(value) && value >= 0; })
        && row.sequence >= row.records && row.bytes >= row.records
        && (row.records === 0) === (row.bytes === 0)
        && (row.records > 0) === Boolean(db.prepare('SELECT 1 FROM events LIMIT 1').get());
}
/** Validate bounded metadata before changing existing data or journal settings. Never repair ambiguous storage. */
export function format(db) {
    const version = db.pragma('user_version', { simple: true });
    const schema = metadata(db);
    if (version === 0 && schema.length === 0) { return false; }
    if (version !== 1) { throw new Error('Unsupported spool format version or nonempty database'); }
    const expected = statements.map((sql) => { return sql.replaceAll(/\s+/gu, ' '); }).sort();
    const actual = schema.map((row) => { return row.sql.replaceAll(/\s+/gu, ' '); }).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected) || !validCounters(db)) { throw new Error('Corrupt spool format or counters'); }
    return true;
}
export function initialize(db) {
    db.transaction(() => {
        db.exec(statements.join(';'));
        db.prepare('INSERT INTO counters VALUES (1,0,0,0)').run(); db.pragma('user_version=1');
    })();
}
