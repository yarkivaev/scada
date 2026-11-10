import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs, { link, mkdtemp, open as openFile, readFile as readContents, readdir, rm, stat, symlink, unlink as removeFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import deliverySpool from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';

describe('SQLite delivery spool contracts', () => {
    let directory;
    const owned = [];
    function spool(options = {}) { const item = deliverySpool(directory, { maxBytes: 1e7, ...options }); owned.push(item); return item; }
    beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'sqlite-spool-')); });
    afterEach(async () => { await Promise.all(owned.splice(0).map((item) => { return item.close?.(); })); await rm(directory, { recursive: true, force: true }); });
    async function legacy(record) {
        const name = `${createHash('sha256').update(record.event.eventId).digest('hex')}.json`;
        await writeFile(path.join(directory, name), JSON.stringify(record)); return name;
    }
    it('stores compressed events with interned destinations and restores exact envelopes and receipts', async () => {
        const item = spool(); await item.open();
        const event = { eventId: 'a', observation: { body: Buffer.from('x'.repeat(10000)) }, destinations: [{ id:'one', secret: { $secret:'rotating' } }] };
        await item.append(event, ['one', 'two']); await item.append({ ...event, eventId:'b' }, ['one']);
        await item.ack('a', 'two');
        const files = await readdir(directory);
        assert.ok(files.includes('delivery.sqlite'));
        const db = new Database(path.join(directory, 'delivery.sqlite'), { readonly:true });
        assert.equal(db.prepare('SELECT count(*) AS count FROM destinations').get().count, 1);
        assert.ok(db.prepare('SELECT length(payload) AS size FROM events LIMIT 1').get().size < 1000); db.close();
        await item.close(); const recovered = spool(); await recovered.open();
        assert.deepEqual((await recovered.pending(1))[0], { event, remaining:['one'] });
    });
    it('rejects concurrent owners and releases ownership on close', async () => {
        const first = spool(); await first.open();
        const second = spool(); await assert.rejects(second.open(), /owner|locked/u);
        await first.close(); await second.open(); assert.equal(second.status().ready, true);
    });
    it('imports legacy receipts and leaves unrelated files', async () => {
        const record = { event:{ eventId:'../a', body:{type:'Buffer',data:[1,2]} }, recipients:['one','two'], remaining:['two'] };
        const name = await legacy(record); await writeFile(path.join(directory, 'unrelated.json'), 'leave');
        const item = spool(); await item.open();
        assert.deepEqual(await item.pending(), [{event:{eventId:'../a',body:Buffer.from([1,2])},remaining:['two']}]);
        assert.ok(!(await readdir(directory)).includes(name));
        assert.equal(await readContents(path.join(directory,'unrelated.json'),'utf8'),'leave');
    });
    it('fails closed on corrupt legacy data without deleting originals or bypassing it on restart', async () => {
        const name = await legacy({ event:{eventId:'a'},recipients:['one'],remaining:['one'] });
        const corrupt = `${'b'.repeat(64)}.json`; await writeFile(path.join(directory, corrupt), 'bad');
        const first=spool(); await assert.rejects(first.open(), /JSON|Corrupt/u);
        assert.ok((await readdir(directory)).includes(corrupt));
        assert.equal(first.status().ready,false);
        const second=spool(); await assert.rejects(second.open(), /JSON|Corrupt/u);
        assert.ok(name);
    });
    it('retains over-capacity legacy records for a later correctly sized recovery', async () => {
        const name = await legacy({event:{eventId:'a'},recipients:['one'],remaining:['one']});
        const small=spool({maxBytes:1}); await assert.rejects(small.open(), /capacity/u);
        assert.ok((await readdir(directory)).includes(name));
        const recovered=spool(); await recovered.open(); assert.equal(recovered.status().pending,1);
    });
    it('refuses committed legacy symlinks', async () => {
        const name = `${'c'.repeat(64)}.json`; await symlink('/etc/hosts',path.join(directory,name));
        await assert.rejects(spool().open(), /regular|symlink/u);
    });
    it('rotates bounded pending windows across restart without resurrecting confirmed recipients', async () => {
        const item=spool(); await item.open();
        await item.append({eventId:'a'},['one','two']); await item.append({eventId:'b'},['one']);
        assert.equal((await item.pending(1))[0].event.eventId,'a');
        await item.ack('a','one'); await item.close();
        const recovered=spool(); await recovered.open();
        assert.equal((await recovered.pending(1))[0].event.eventId,'b');
        assert.deepEqual((await recovered.pending(1))[0].remaining,['two']);
    });
    it('retains committed observation and ACK after SIGKILL and rejects a separate process owner', async () => {
        const child = fork(new URL('../../../helpers/runtime/spoolChild.js',import.meta.url),[directory,'write'],{silent:true});
        try {
            const [message]=await once(child,'message'); assert.equal(message,'committed');
            const rival=fork(new URL('../../../helpers/runtime/spoolChild.js',import.meta.url),[directory,'probe'],{silent:true});
            const exited=once(rival,'exit'); const [rejection]=await once(rival,'message');
            assert.match(rejection.error,/locked/u); await exited;
        } finally { const exited=once(child,'exit'); child.kill('SIGKILL'); await exited; }
        const recovered=spool(); await recovered.open();
        assert.deepEqual(await recovered.pending(),[{event:{eventId:'durable',body:Buffer.from('observation')},remaining:['two']}]);
    });
    it('reconciles a committed legacy import after an interruption before unlink', async () => {
        const record={event:{eventId:'legacy'},recipients:['one','two'],remaining:['two']};
        const name=await legacy(record); const original=await readContents(path.join(directory,name));
        const first=spool(); await first.open(); await first.close();
        await writeFile(path.join(directory,name),original);
        const second=spool(); await second.open();
        assert.equal(second.status().pending,1); assert.deepEqual((await second.pending())[0].remaining,['two']);
    });
    it('fails closed on unknown database formats and leaves the database intact', async () => {
        const first=spool(); await first.open(); await first.append({eventId:'a'},['one']); await first.close();
        const db=new Database(path.join(directory,'delivery.sqlite')); db.pragma('user_version=99'); db.close();
        await assert.rejects(spool().open(),/format version/u);
        const check=new Database(path.join(directory,'delivery.sqlite'),{readonly:true});
        assert.equal(check.prepare('SELECT count(*) AS count FROM events').get().count,1); check.close();
    });
    it('rejects a corrupt database without deleting pending data', async () => {
        const file=path.join(directory,'delivery.sqlite'); await writeFile(file,'corrupt-database');
        await assert.rejects(spool().open(),/database/u); assert.equal(await readContents(file,'utf8'),'corrupt-database');
    });
    it('transactionally accounts logical bytes and releases descriptors only after all confirmations', async () => {
        const event={eventId:'a',destinations:[{id:'one',url:{$secret:'broker'}}]};
        const recipients=['one','two'];
        const logical=Buffer.byteLength(JSON.stringify({event,recipients,remaining:recipients}));
        const item=spool({maxBytes:logical,maxRecords:1}); await item.open(); await item.append(event,recipients);
        assert.equal(item.status().bytes,logical);
        await assert.rejects(item.append({...event,eventId:'b'},['one']),/capacity/u);
        await item.ack('a','one');
        assert.equal(item.status().bytes,Buffer.byteLength(JSON.stringify({event,recipients,remaining:['two']})));
        await item.ack('a','two'); assert.equal(item.status().bytes,0);
        const db=new Database(path.join(directory,'delivery.sqlite'),{readonly:true});
        assert.equal(db.prepare('SELECT count(*) AS count FROM destinations').get().count,0); db.close();
    });
    it('uses private files for durable events and ownership', async () => {
        const item=spool(); await item.open();
        for (const name of ['delivery.sqlite','owner.sqlite']) {
            // eslint-disable-next-line no-await-in-loop
            const info=await stat(path.join(directory,name)); assert.equal(info.mode % 512,384);
        }
    });

    it('rejects legacy records missing receipt state rather than reconstructing ambiguous acknowledgements', async () => {
        const name=await legacy({event:{eventId:'missing-receipts'},recipients:['one']});
        await assert.rejects(spool().open(),/Corrupt|corrupt/u);
        assert.ok((await readdir(directory)).includes(name));
    });
    it('recovers an import committed before unlink fails without skipping the original on restart', async () => {
        const name=await legacy({event:{eventId:'interrupted'},recipients:['one','two'],remaining:['two']});
        const original=fs.unlink;
        fs.unlink=async function unlink(file) {
            if (file===path.join(directory,name)) { throw new Error('simulated unlink interruption'); }
            return original(file);
        }; syncBuiltinESMExports();
        try { await assert.rejects(spool().open(),/simulated unlink interruption/u); }
        finally { Object.assign(fs,{unlink:original}); syncBuiltinESMExports(); }
        assert.ok((await readdir(directory)).includes(name));
        const recovered=spool(); await recovered.open();
        assert.deepEqual(await recovered.pending(),[{event:{eventId:'interrupted'},remaining:['two']}]);
        assert.ok(!(await readdir(directory)).includes(name));
    });

    it('keeps the first owner locked after a rejected same-process contender and directory alias', async () => {
        const first=spool(); await first.open();
        async function rejectedChild() {
            const child=fork(new URL('../../../helpers/runtime/spoolChild.js',import.meta.url),[directory,'probe'],{silent:true});
            const exited=once(child,'exit'); const [message]=await once(child,'message'); await exited;
            assert.match(message.error ?? '',/locked/u);
        }
        await rejectedChild(); await assert.rejects(spool().open(),/owner|locked/u);
        const parentAlias=path.join(directory,'parent-alias'); await symlink(path.dirname(directory),parentAlias);
        const alias=deliverySpool(path.join(parentAlias,path.basename(directory)),{maxBytes:1000000});
        try { await assert.rejects(alias.open(),/owner|locked/u); } finally { await alias.close(); }
        await rejectedChild(); await first.append({eventId:'still-owned'},['one']);
    });
    it('refuses hard-linked SQLite sidecars without changing unrelated bytes or permissions', async () => {
        const unrelated=path.join(directory,'unrelated.bin'); const original=Buffer.alloc(1600,7);
        await writeFile(unrelated,original,{mode:0o640});
        const mode=(await stat(unrelated)).mode;
        for (const name of ['delivery.sqlite-shm','delivery.sqlite-wal','delivery.sqlite-journal','owner.sqlite-journal','owner.sqlite-wal','owner.sqlite-shm']) {
            // eslint-disable-next-line no-await-in-loop
            await link(unrelated,path.join(directory,name));
            // eslint-disable-next-line no-await-in-loop
            await assert.rejects(spool().open(),/regular|link|private/u);
            // eslint-disable-next-line no-await-in-loop
            assert.deepEqual(await readContents(unrelated),original);
            // eslint-disable-next-line no-await-in-loop
            assert.equal((await stat(unrelated)).mode,mode);
            // eslint-disable-next-line no-await-in-loop
            await removeFile(path.join(directory,name));
        }
    });
    it('does not recreate missing spool counters or bypass record admission after ambiguous damage', async () => {
        const first=spool({maxRecords:1}); await first.open(); await first.append({eventId:'retained'},['one']); await first.close();
        const db=new Database(path.join(directory,'delivery.sqlite')); db.prepare('DELETE FROM counters').run(); db.close();
        const broken=spool({maxRecords:1}); await assert.rejects(broken.open(),/Corrupt|format/u);
        assert.equal(broken.status().ready,false); await assert.rejects(broken.append({eventId:'b'},['one']),/not opened/u);
        const verify=new Database(path.join(directory,'delivery.sqlite'),{readonly:true});
        assert.equal(verify.prepare('SELECT count(*) AS count FROM counters').get().count,0);
        assert.equal(verify.prepare('SELECT count(*) AS count FROM events').get().count,1); verify.close();
    });
    it('rejects an unrelated unversioned SQLite database without modifying its schema or journal mode', async () => {
        const db=new Database(path.join(directory,'delivery.sqlite')); db.exec('CREATE TABLE unrelated (value TEXT)'); db.close();
        await assert.rejects(spool().open(),/format|empty/u);
        const verify=new Database(path.join(directory,'delivery.sqlite'),{readonly:true});
        assert.equal(verify.pragma('user_version',{simple:true}),0);
        assert.equal(verify.pragma('journal_mode',{simple:true}),'delete');
        assert.deepEqual(verify.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all(),[{name:'unrelated'}]); verify.close();
    });
    it('rejects an oversized sparse committed legacy file before reading its body', async () => {
        const name=await legacy({event:{eventId:'oversized'},recipients:['one'],remaining:['one']});
        const handle=await openFile(path.join(directory,name),'r+'); await handle.truncate(128*1024*1024); await handle.close();
        const original=fs.open;
        fs.open=async function open(file,...args) {
            const opened=await original(file,...args);
            if (file===path.join(directory,name)) {
                opened.readFile=async function readFile() { throw new Error('unbounded legacy read attempted'); };
                opened.read=async function read() { throw new Error('legacy body read before capacity check'); };
            }
            return opened;
        }; syncBuiltinESMExports();
        try { await assert.rejects(spool({maxBytes:1000}).open(),/capacity/u); }
        finally { Object.assign(fs,{open:original}); syncBuiltinESMExports(); }
        assert.equal((await stat(path.join(directory,name))).size,128*1024*1024);
    });

});
