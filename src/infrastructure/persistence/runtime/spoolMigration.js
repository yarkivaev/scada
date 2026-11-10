import { open, opendir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { decoded, digest, encoded, revive } from './spoolCodec.js';
import { insert } from './spoolRecords.js';

async function load(directory, name) {
    const handle = await open(path.join(directory, name), constants.O_RDONLY + constants.O_NOFOLLOW);
    try {
        const info = await handle.stat();
        if (!info.isFile()) { throw new Error('Spool requires regular legacy file'); }
        return await handle.readFile('utf8');
    } finally { await handle.close(); }
}
function verify(db, value) {
    const row = db.prepare('SELECT * FROM events WHERE id=?').get(value.id);
    if (!row || row.fingerprint !== value.fingerprint || row.remaining !== value.remaining
        || encoded(decoded(row, db).event, JSON.parse(row.recipients), JSON.parse(row.remaining)).fingerprint !== value.fingerprint) {
        throw new Error('Legacy import verification failed');
    }
}
/* eslint max-statements: ["error", 20] */
async function migrateFile(directory, name, db, limits) {
    const text = await load(directory, name);
    const record = JSON.parse(text, revive);
    if (!Array.isArray(record.remaining)) { throw new Error('Corrupt spool receipt state'); }
    const value = encoded(record.event, record.recipients, record.remaining);
    if (`${digest(record.event.eventId)}.json` !== name) { throw new Error('Corrupt spool record filename'); }
    const hash = digest(text);
    db.transaction(() => {
        const imported = db.prepare('SELECT digest FROM imports WHERE name=?').get(name);
        if (imported && imported.digest !== hash) { throw new Error('Conflicting legacy import'); }
        insert(db, value, limits.maxBytes, limits.maxRecords);
        db.prepare('INSERT OR IGNORE INTO imports VALUES (?,?,?)').run(name, hash, value.id);
    })();
    verify(db, value);
    // Verify source unchanged after commit before unlink; owner excludes compliant concurrent writers.
    if (digest(await load(directory, name)) !== hash) { throw new Error('Legacy import source changed'); }
    await unlink(path.join(directory, name));
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
}
export default async function spoolMigration(directory, db, limits) {
    const files = await opendir(directory);
    for await (const file of files) {
        if (/^[a-f0-9]{64}\.json$/u.test(file.name)) {
            if (!file.isFile()) { throw new Error('Spool requires regular legacy file; symlink refused'); }
            // Bound migration memory independently of legacy directory size.
            await migrateFile(directory, file.name, db, limits);
        }
    }
    // Import ledger is no longer needed once every original is durably removed.
    db.prepare('DELETE FROM imports').run();
}
