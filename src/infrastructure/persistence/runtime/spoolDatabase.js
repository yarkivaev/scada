import Database from 'better-sqlite3';
import path from 'node:path';
import { lstat, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { format, initialize } from './spoolFormat.js';
import { replayFiles, replayIndex } from './spoolReplay.js';

// POSIX closes release this process's advisory locks for an inode, even from unrelated descriptors.
// Reserve directory identity before opening ANY owner descriptor, including rejected contenders.
const registry = Symbol.for('@yarkivaev/scada/delivery-spool-owners');
globalThis[registry] ??= new Set();
const owners = globalThis[registry];
const files = [...['owner.sqlite', 'delivery.sqlite'].flatMap((name) => { return [name, `${name}-journal`, `${name}-wal`, `${name}-shm`]; }), ...replayFiles];
export async function regular(file) {
    try {
        const info = await lstat(file);
        if (!info.isFile() || info.nlink !== 1) { throw new Error('Spool requires private regular files; symlink/hardlink refused'); }
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
export function counters(db) { return db.prepare('SELECT bytes, records, sequence FROM counters WHERE id=1').get(); }
export function capacity(db, maxBytes, maxRecords) {
    const totals = counters(db);
    if (totals.records > maxRecords) { throw new Error('Spool record capacity exceeded'); }
    if (totals.bytes > maxBytes) { throw new Error('Spool capacity exceeded'); }
    return totals;
}
async function reservation(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink()) { throw new Error('Spool directory symlink refused'); }
    const key = `${info.dev}:${info.ino}`;
    if (owners.has(key)) { throw new Error('Spool already has an owner'); }
    owners.add(key); return key;
}
/* eslint max-statements: ["error", 30] */
export async function database(directory) {
    const key = await reservation(directory);
    let owner;
    let db;
    try {
        for (const suffix of files) {
            // Check all main files and SQLite sidecars before SQLite can modify an alias.
            // eslint-disable-next-line no-await-in-loop
            await regular(path.join(directory, suffix));
        }
        await privateFile(path.join(directory, 'owner.sqlite'));
        owner = new Database(path.join(directory, 'owner.sqlite'), { timeout: 0 });
        owner.exec('BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER)');
        await privateFile(path.join(directory, 'delivery.sqlite'));
        db = new Database(path.join(directory, 'delivery.sqlite'), { timeout: 0 });
        const existing = format(db);
        db.pragma('journal_mode = WAL'); db.pragma('synchronous = FULL');
        db.pragma('cache_size = -2048'); db.pragma('wal_autocheckpoint = 256');
        db.pragma('journal_size_limit = 1048576'); db.pragma('secure_delete = FAST');
        if (!existing) { initialize(db); }
        await replayIndex(db, directory);
        return { db, owner: { close() { try { owner.close(); } finally { owners.delete(key); } } } };
    } catch (error) {
        try { db?.close(); } finally { try { owner?.close(); } finally { owners.delete(key); } }
        throw error;
    }
}
export function checkpoint(db) { db.pragma('wal_checkpoint(TRUNCATE)'); }
