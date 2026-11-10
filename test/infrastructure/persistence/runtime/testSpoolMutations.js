import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import deliverySpool from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';

const append=(id,value=id)=>{return {kind:'append',event:{eventId:id,value},recipients:['one','two']};};
describe('grouped durable spool mutations',()=>{
    let directory; const owned=[];
    function spool(options={}){const value=deliverySpool(directory,{maxBytes:100000,...options});owned.push(value);return value;}
    beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'mutations-'));});
    afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));await rm(directory,{recursive:true,force:true});});
    it('commits append and receipt operations in FIFO order and recovers exact remaining recipients',async()=>{
        const item=spool();await item.open();
        assert.deepEqual(await item.mutateMany([append('a'),{kind:'ack',eventId:'a',recipient:'one'},append('b')]),[{ok:true},{ok:true},{ok:true}]);
        await item.close();const recovered=spool();await recovered.open();
        assert.deepEqual((await recovered.pending()).map(row=>{return [row.event.eventId,row.remaining];}),[['a',['two']],['b',['one','two']]]);
    });
    it('isolates conflicting identities, invalid recipients and logical capacity failures with savepoints',async()=>{
        const item=spool({maxRecords:2});await item.open();
        const results=await item.mutateMany([append('a'),append('a','different'),{kind:'ack',eventId:'a',recipient:'bad'},append('b'),append('c')]);
        assert.deepEqual(results.map(result=>{return result.ok;}),[true,false,false,true,false]);
        assert.match(results[1].error.message,/identity/u);assert.match(results[2].error.message,/recipient/u);assert.match(results[4].error.message,/capacity/u);
        assert.equal(item.status().pending,2);assert.equal(item.status().ready,true);
        await item.append({eventId:'a',value:'a'},['one','two']);await item.ack('a','one');
        assert.deepEqual((await item.pending())[0].remaining,['two']);
    });
    it('rolls back the whole group and releases ownership on a SQLite mutation error',async()=>{
        const item=spool();await item.open();const db=new Database(path.join(directory,'delivery.sqlite'));
        db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON events WHEN NEW.id='fatal' BEGIN SELECT RAISE(ABORT,'fault'); END");
        try{await assert.rejects(item.mutateMany([append('before'),append('fatal'),append('after')]),/fault/u);assert.equal(item.status().ready,false);}
        finally{db.exec('DROP TRIGGER fail_insert');db.close();}
        const recovered=spool();await recovered.open();assert.equal(recovered.status().pending,0);
    });
    it('rejects every result on an ambiguous error after actual COMMIT, then recovers committed events',async()=>{
        const item=spool();await item.open();const original=Database.prototype.transaction;let injected=false;
        Database.prototype.transaction=function transaction(action){
            const self=this;const run=original.call(self,action);
            return function(...args){const outer=!self.inTransaction;const result=run(...args);if(outer&&!injected){injected=true;const error=new Error('ambiguous commit');error.code='SQLITE_IOERR';throw error;}return result;};
        };
        try{await assert.rejects(item.mutateMany([append('a'),append('b')]),/ambiguous commit/u);assert.equal(item.status().ready,false);}
        finally{Object.assign(Database.prototype,{transaction:original});}
        const recovered=spool();await recovered.open();assert.equal(recovered.status().pending,2);
    });
    it('recovers no unaccepted buffered writes after SIGKILL before a sparse group flush',async()=>{
        const child=fork(new URL('../../../helpers/runtime/groupedSpoolChild.js',import.meta.url),[directory,'buffered'],{silent:true});
        try{const [message]=await once(child,'message');assert.equal(message,'buffered');}finally{const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
        const recovered=spool();await recovered.open();assert.equal(recovered.status().pending,0);
    });
    it('recovers every grouped observation and partial receipt after SIGKILL following COMMIT',async()=>{
        const child=fork(new URL('../../../helpers/runtime/groupedSpoolChild.js',import.meta.url),[directory,'committed'],{silent:true});
        try{const [message]=await once(child,'message');assert.equal(message,'committed');}finally{const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
        const recovered=spool();await recovered.open();assert.deepEqual(await recovered.pending(),[{event:{eventId:'a',body:Buffer.from('frozen')},remaining:['two']},{event:{eventId:'b'},remaining:['one']}]);
    });

});
