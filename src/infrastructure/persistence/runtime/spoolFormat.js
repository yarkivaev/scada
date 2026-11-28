const canonical = [
    'CREATE TABLE counters (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, records INTEGER NOT NULL, sequence INTEGER NOT NULL)',
    'CREATE TABLE destinations (id TEXT PRIMARY KEY, json TEXT NOT NULL, refs INTEGER NOT NULL)',
    `CREATE TABLE events (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload BLOB NOT NULL,
 destinations TEXT, recipients TEXT NOT NULL, remaining TEXT NOT NULL, bytes INTEGER NOT NULL, sequence INTEGER NOT NULL)`,
    'CREATE INDEX event_sequence ON events(sequence)',
    'CREATE TABLE imports (name TEXT PRIMARY KEY, digest TEXT NOT NULL, event_id TEXT NOT NULL)'
];
const replayPending = `CREATE TABLE replay_pending (target TEXT NOT NULL, event_id TEXT NOT NULL, recipient TEXT NOT NULL, sequence INTEGER NOT NULL,
 PRIMARY KEY(target,sequence,event_id,recipient)) WITHOUT ROWID`;
const replayIndexes = [
    'CREATE UNIQUE INDEX replay_event_recipient ON replay_pending(event_id,recipient)',
    'CREATE TABLE replay_targets (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL)',
    'CREATE INDEX replay_target_sequence ON replay_targets(sequence)'
];
const current = [...canonical, replayPending, ...replayIndexes];

function metadata(db) {
    return db.prepare("SELECT sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT ?").all(current.length + 1);
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
    if (version === 0 && schema.length === 0) { return 0; }
    if (version !== 1 && version !== 2) { throw new Error('Unsupported spool format version or nonempty database'); }
    const expected = (version === 1 ? canonical : current).map((sql) => { return sql.replaceAll(/\s+/gu, ' '); }).sort();
    const actual = schema.map((row) => { return row.sql.replaceAll(/\s+/gu, ' '); }).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected) || !validCounters(db)) { throw new Error('Corrupt spool format or counters'); }
    return version;
}

function populateReplay(db) {
    db.exec(`INSERT INTO replay_pending
      SELECT COALESCE(json_extract(e.destinations,'$['||r.key||']'),'legacy:'||r.value) AS target, e.id, r.value, e.sequence
      FROM events e, json_each(e.recipients) r
      WHERE r.value IN (SELECT value FROM json_each(e.remaining))
      ORDER BY target, e.sequence, e.id, r.value`);
}

export function initialize(db, version) {
    // The schema version and derived rows commit together under the spool owner's lock.
    db.transaction(() => {
        if (version === 0) {
            db.exec(canonical.join(';'));
            db.prepare('INSERT INTO counters VALUES (1,0,0,0)').run();
        }
        db.exec(replayPending);
        if (version === 1) { populateReplay(db); }
        db.exec(replayIndexes.join(';'));
        db.exec('INSERT INTO replay_targets SELECT target,MIN(sequence) FROM replay_pending GROUP BY target');
        db.pragma('user_version=2');
    })();
}
