import { capacity, counters } from './spoolDatabase.js';
import { decoded, encoded } from './spoolCodec.js';

export function insert(db, value, maxBytes, maxRecords) {
    const existing = db.prepare('SELECT fingerprint FROM events WHERE id=?').get(value.id);
    if (existing) {
        if (existing.fingerprint !== value.fingerprint) { throw new Error('Conflicting event identity'); }
        return;
    }
    const totals = counters(db);
    if (totals.records >= maxRecords) { throw new Error('Spool record capacity exceeded'); }
    if (totals.bytes + value.bytes > maxBytes) { throw new Error('Spool capacity exceeded'); }
    for (const descriptor of value.destinations ?? []) {
        db.prepare('INSERT INTO destinations VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET refs=refs+1').run(descriptor.id, descriptor.json);
    }
    db.prepare('INSERT INTO events VALUES (@id,@fingerprint,@payload,@destinations,@recipients,@remaining,@bytes,@sequence)').run({
        ...value, destinations: value.destinations ? JSON.stringify(value.destinations.map((item) => { return item.id; })) : null,
        sequence: totals.sequence + 1
    });
    db.prepare('UPDATE counters SET bytes=bytes+?,records=records+1,sequence=sequence+1 WHERE id=1').run(value.bytes);
}
function remove(db, row) {
    db.prepare('DELETE FROM events WHERE id=?').run(row.id);
    db.prepare('UPDATE counters SET bytes=bytes-?,records=records-1 WHERE id=1').run(row.bytes);
    for (const id of JSON.parse(row.destinations ?? '[]')) {
        db.prepare('UPDATE destinations SET refs=refs-1 WHERE id=?').run(id);
        db.prepare('DELETE FROM destinations WHERE id=? AND refs=0').run(id);
    }
}
export function acknowledge(db, id, recipient) {
    const row = db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!row) { return; }
    if (!JSON.parse(row.recipients).includes(recipient)) { throw new Error('Unknown recipient'); }
    const remaining = JSON.parse(row.remaining).filter((item) => { return item !== recipient; });
    if (!remaining.length) { remove(db, row); return; }
    const record = decoded(row, db);
    const value = encoded(record.event, JSON.parse(row.recipients), remaining);
    db.prepare('UPDATE events SET remaining=?,bytes=? WHERE id=?').run(value.remaining, value.bytes, id);
    db.prepare('UPDATE counters SET bytes=bytes+? WHERE id=1').run(value.bytes - row.bytes);
}
export function pending(db, limit) {
    const rows = db.prepare('SELECT * FROM events ORDER BY sequence LIMIT ?').all(limit);
    let { sequence } = counters(db);
    for (const row of rows) {
        sequence += 1; db.prepare('UPDATE events SET sequence=? WHERE id=?').run(sequence, row.id);
    }
    db.prepare('UPDATE counters SET sequence=? WHERE id=1').run(sequence);
    return rows.map((row) => { return decoded(row, db); });
}
export function admission(db, maxBytes, maxRecords) { return capacity(db, maxBytes, maxRecords); }
