import { decoded } from './spoolCodec.js';

export function indexInsert(db, value, sequence) {
    const recipients = JSON.parse(value.recipients);
    for (const recipient of JSON.parse(value.remaining)) {
        const target = value.destinations?.[recipients.indexOf(recipient)]?.id ?? `legacy:${recipient}`;
        db.prepare('INSERT INTO replay_pending VALUES (?,?,?,?)').run(target, value.id, recipient, sequence);
        db.prepare('INSERT OR IGNORE INTO replay_targets VALUES (?,?)').run(target, sequence);
    }
}
export function indexAck(db, id, recipient) {
    const row = db.prepare('SELECT target FROM replay_pending WHERE event_id=? AND recipient=?').get(id, recipient);
    if (!row) { return; }
    db.prepare('DELETE FROM replay_pending WHERE event_id=? AND recipient=?').run(id, recipient);
    if (!db.prepare('SELECT 1 FROM replay_pending WHERE target=? LIMIT 1').get(row.target)) {
        db.prepare('DELETE FROM replay_targets WHERE id=?').run(row.target);
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
    const targets = db.prepare(`SELECT id FROM replay_targets ${where} ORDER BY sequence LIMIT ?`).all(...excluded, Math.min(limit, 64));
    const pages = targets.map(({id}) => { return db.prepare('SELECT event_id,recipient,target FROM replay_pending WHERE target=? ORDER BY sequence LIMIT ?').all(id, limit); });
    const selected = interleaved(pages, limit);
    let {sequence} = db.prepare('SELECT sequence FROM counters WHERE id=1').get();
    const rows = [...selected].map(([id, pairs]) => {
        for (const pair of pairs) {
            sequence += 1;
            db.prepare('UPDATE replay_pending SET sequence=? WHERE event_id=? AND recipient=?').run(sequence, id, pair.recipient);
        }
        const row = decoded(db.prepare('SELECT * FROM events WHERE id=?').get(id), db);
        return {...row, remaining:pairs.map(pair => { return pair.recipient; }), targets:Object.fromEntries(pairs.map(pair => { return [pair.recipient,pair.target]; }))};
    });
    for (const {id} of targets) {
        sequence += 1; db.prepare('UPDATE replay_targets SET sequence=? WHERE id=?').run(sequence, id);
    }
    db.prepare('UPDATE counters SET sequence=? WHERE id=1').run(sequence);
    return rows;
}
