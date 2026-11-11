import path from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { decoded } from './spoolCodec.js';

export const replayFiles = ['replay-index.sqlite', 'replay-index.sqlite-journal', 'replay-index.sqlite-wal', 'replay-index.sqlite-shm'];
/** Disposable routing index. Every open rebuilds from canonical FULL-committed event metadata. */
export async function replayIndex(db, directory) {
    for (const name of replayFiles) {
        // Caller holds the directory owner and has rejected aliases before any mutation.
        // eslint-disable-next-line no-await-in-loop
        await unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') { throw error; } });
    }
    const file = path.join(directory, replayFiles[0]);
    const handle = await open(file, constants.O_RDWR + constants.O_CREAT + constants.O_EXCL + constants.O_NOFOLLOW, 0o600);
    await handle.close();
    db.prepare('ATTACH DATABASE ? AS replay').run(file);
    db.exec(`PRAGMA replay.journal_mode=MEMORY; PRAGMA replay.synchronous=OFF; PRAGMA replay.cache_size=-2048;
      CREATE TABLE replay.targets (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL);
      CREATE INDEX replay.target_sequence ON targets(sequence);
      CREATE TABLE replay.pending (target TEXT NOT NULL, event_id TEXT NOT NULL, recipient TEXT NOT NULL, sequence INTEGER NOT NULL,
        PRIMARY KEY(target,sequence,event_id,recipient)) WITHOUT ROWID;
      CREATE UNIQUE INDEX replay.event_recipient ON pending(event_id,recipient);
      INSERT INTO replay.pending
        SELECT COALESCE(json_extract(e.destinations,'$['||r.key||']'),'legacy:'||r.value), e.id, r.value, e.sequence
        FROM main.events e, json_each(e.recipients) r
        WHERE r.value IN (SELECT value FROM json_each(e.remaining));
      INSERT INTO replay.targets SELECT target,MIN(sequence) FROM replay.pending GROUP BY target;`);
}
export function indexInsert(db, value, sequence) {
    const recipients = JSON.parse(value.recipients);
    for (const recipient of JSON.parse(value.remaining)) {
        const target = value.destinations?.[recipients.indexOf(recipient)]?.id ?? `legacy:${recipient}`;
        db.prepare('INSERT INTO replay.pending VALUES (?,?,?,?)').run(target, value.id, recipient, sequence);
        db.prepare('INSERT OR IGNORE INTO replay.targets VALUES (?,?)').run(target, sequence);
    }
}
export function indexAck(db, id, recipient) {
    const row = db.prepare('SELECT target FROM replay.pending WHERE event_id=? AND recipient=?').get(id, recipient);
    if (!row) { return; }
    db.prepare('DELETE FROM replay.pending WHERE event_id=? AND recipient=?').run(id, recipient);
    if (!db.prepare('SELECT 1 FROM replay.pending WHERE target=? LIMIT 1').get(row.target)) {
        db.prepare('DELETE FROM replay.targets WHERE id=?').run(row.target);
    }
}
/* eslint max-depth: ["error", 4] */
function interleaved(pages, limit) {
    const selected = new Map();
    for (let offset = 0; offset < limit; offset += 1) {
        for (const page of pages) {
            const item = page[offset];
            if (item && (selected.has(item.event_id) || selected.size < limit)) {
                const pairs = selected.get(item.event_id) ?? [];
                pairs.push(item); selected.set(item.event_id, pairs);
            }
        }
    }
    return selected;
}
/* eslint max-statements: ["error", 20] */
/** Bounded destination and event pages; no payload decoding or scan proportional to an offline backlog. */
export function pendingFair(db, limit, blocked) {
    const excluded = [...blocked];
    const where = excluded.length ? `WHERE id NOT IN (${excluded.map(() => { return '?'; }).join(',')})` : '';
    const targets = db.prepare(`SELECT id FROM replay.targets ${where} ORDER BY sequence LIMIT ?`).all(...excluded, Math.min(limit, 64));
    const pages = targets.map(({id}) => { return db.prepare('SELECT event_id,recipient,target FROM replay.pending WHERE target=? ORDER BY sequence LIMIT ?').all(id, limit); });
    const selected = interleaved(pages, limit);
    let {sequence} = db.prepare('SELECT sequence FROM counters WHERE id=1').get();
    const rows = [...selected].map(([id, pairs]) => {
        for (const pair of pairs) {
            sequence += 1;
            db.prepare('UPDATE replay.pending SET sequence=? WHERE event_id=? AND recipient=?').run(sequence, id, pair.recipient);
        }
        const row = decoded(db.prepare('SELECT * FROM events WHERE id=?').get(id), db);
        return {...row, remaining:pairs.map(pair => { return pair.recipient; }), targets:Object.fromEntries(pairs.map(pair => { return [pair.recipient,pair.target]; }))};
    });
    for (const {id} of targets) {
        sequence += 1; db.prepare('UPDATE replay.targets SET sequence=? WHERE id=?').run(sequence, id);
    }
    db.prepare('UPDATE counters SET sequence=? WHERE id=1').run(sequence);
    return rows;
}
