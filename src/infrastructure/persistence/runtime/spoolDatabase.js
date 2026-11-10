import Database from 'better-sqlite3';
import path from 'node:path';
import { lstat, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';

export async function regular(file) {
    try {
        const info = await lstat(file);
        if (!info.isFile()) { throw new Error('Spool requires regular files; symlink refused'); }
    } catch (error) { if (error.code !== 'ENOENT') { throw error; } }
}
async function privateFile(file) {
    const handle = await open(file, constants.O_RDWR + constants.O_CREAT + constants.O_NOFOLLOW, 0o600);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1) { throw new Error('Spool requires a private regular file'); }
        await handle.chmod(0o600);
    } finally { await handle.close(); }
}
const schema = `
CREATE TABLE IF NOT EXISTS counters (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL, records INTEGER NOT NULL, sequence INTEGER NOT NULL);
INSERT OR IGNORE INTO counters VALUES (1,0,0,0);
CREATE TABLE IF NOT EXISTS destinations (id TEXT PRIMARY KEY, json TEXT NOT NULL, refs INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload BLOB NOT NULL,
 destinations TEXT, recipients TEXT NOT NULL, remaining TEXT NOT NULL, bytes INTEGER NOT NULL, sequence INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS event_sequence ON events(sequence);
CREATE TABLE IF NOT EXISTS imports (name TEXT PRIMARY KEY, digest TEXT NOT NULL, event_id TEXT NOT NULL);
PRAGMA user_version=1;`;

export function counters(db) { return db.prepare('SELECT bytes, records, sequence FROM counters WHERE id=1').get(); }
export function capacity(db, maxBytes, maxRecords) {
    const totals = counters(db);
    if (totals.records > maxRecords) { throw new Error('Spool record capacity exceeded'); }
    if (totals.bytes > maxBytes) { throw new Error('Spool capacity exceeded'); }
    return totals;
}
/* eslint max-statements: ["error", 30] */
export async function database(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) { throw new Error('Spool directory symlink refused'); }
    for (const suffix of ['owner.sqlite', 'owner.sqlite-journal', 'delivery.sqlite', 'delivery.sqlite-wal', 'delivery.sqlite-shm']) {
        // No user-controlled database/sidecar symlinks.
        // eslint-disable-next-line no-await-in-loop
        await regular(path.join(directory, suffix));
    }
    await privateFile(path.join(directory, 'owner.sqlite'));
    const owner = new Database(path.join(directory, 'owner.sqlite'), { timeout: 0 });
    let db;
    try {
        owner.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER)');
        await privateFile(path.join(directory, 'delivery.sqlite'));
        db = new Database(path.join(directory, 'delivery.sqlite'), { timeout: 0 });
        const version = db.pragma('user_version', { simple: true });
        if (version !== 0 && version !== 1) { throw new Error('Unsupported spool format version'); }
        db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL');
        db.pragma('cache_size = -2048'); db.pragma('wal_autocheckpoint = 256');
        db.pragma('journal_size_limit = 1048576'); db.pragma('secure_delete = FAST');
        db.transaction(() => { db.exec(schema); })();
        return { db, owner };
    } catch (error) { db?.close(); owner.close(); throw error; }
}
export function checkpoint(db) { db.pragma('wal_checkpoint(TRUNCATE)'); }
