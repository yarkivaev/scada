import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import createQueue from '../../../src/application/runtime/deliveryQueue.js';
const destinations=[{id:'one',type:'amqp'}];
function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
const pause=ms=>{return new Promise(resolve=>{setTimeout(resolve,ms);});};
function transactions(){
    const original=Database.prototype.transaction;let count=0;
    Database.prototype.transaction=function transaction(action){const self=this;const run=original.call(self,action);return function(...args){if(!self.inTransaction){count+=1;}return run(...args);};};
    return {count(){return count;},restore(){Object.assign(Database.prototype,{transaction:original});}};
}
describe('grouped node delivery queue',()=>{
    let directory;const owned=[];
    function queue(options={}){const value=createQueue(directory,{maxBytes:100000,factory(){return {async write(){}};},...options});owned.push(value);return value;}
    beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'grouped-queue-'));});
    afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));await rm(directory,{recursive:true,force:true});});
    it('coalesces concurrent accept calls into one actual SQLite outer commit',async()=>{
        const item=queue();await item.open();const observed=transactions();
        try{await Promise.all(['a','b','c'].map(eventId=>{return item.accept({eventId},destinations);}));assert.equal(observed.count(),1);assert.equal(item.status().pending,3);}
        finally{observed.restore();}
    });
    it('groups confirmed receipts rather than committing once per recipient',async()=>{
        const item=queue();await item.open();await Promise.all(['a','b','c'].map(eventId=>{return item.accept({eventId},destinations);}));
        const observed=transactions();try{assert.deepEqual(await item.drain(),{delivered:3,failed:0});assert.equal(observed.count(),2);assert.equal(item.status().pending,0);}finally{observed.restore();}
    });
    it('flushes accepted sparse groups on close and freezes event buffers and recipients',async()=>{
        const item=queue({groupCommit:{maxDelayMs:1000}});await item.open();const body=Buffer.from('frozen');const target=[{id:'one',type:'amqp'}];
        const accepted=item.accept({eventId:'a',body},target);body.fill(0);target[0].id='changed';
        await Promise.race([item.close(),pause(500).then(()=>{throw new Error('Close did not force sparse flush');})]);await accepted;
        const received=[];const recovered=queue({factory(spec){return {async write(records){received.push([spec.id,records[0].body.toString()]);}};}});await recovered.open();await recovered.drain();assert.deepEqual(received,[['one','frozen']]);
    });
    it('keeps receipt reservations through confirmation and allows that receipt during graceful close',async()=>{
        const entered=gate();const confirmed=gate();const item=queue({maxOperations:1,factory(){return {async write(){entered.resolve();await confirmed.promise;}};}});
        await item.open();await item.accept({eventId:'a'},destinations);const draining=item.drain();await entered.promise;
        try{await assert.rejects(item.accept({eventId:'b'},destinations),/capacity/u);}catch(error){confirmed.resolve();await draining;throw error;}
        let closed=false;const closing=item.close().then(()=>{closed=true;});await pause(5);assert.equal(closed,false);
        confirmed.resolve();assert.deepEqual(await draining,{delivered:1,failed:0});await closing;
        const recovered=queue();await recovered.open();assert.equal(recovered.status().pending,0);
    });
    it('checks count before snapshotting rejected callers and bounds retained pending bytes',async()=>{
        const item=queue({maxOperations:1});await item.open();const first=item.accept({eventId:'a'},destinations);let snapshots=0;
        await assert.rejects(item.accept({eventId:'b',toJSON(){snapshots+=1;return {eventId:'b'};}},destinations),/capacity/u);assert.equal(snapshots,0);await first;await item.close();
        const bytes=queue({maxPendingBytes:512});await bytes.open();const kept=bytes.accept({eventId:'small'},destinations);
        await assert.rejects(bytes.accept({eventId:'large',value:'x'.repeat(1000)},destinations),/byte capacity/u);await kept;assert.equal(bytes.status().pending,2);
    });
    it('rejects every grouped caller on SQLite failure without leaking ownership or a committed prefix',async()=>{
        const item=queue();await item.open();const db=new Database(path.join(directory,'delivery.sqlite'));
        db.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON events WHEN NEW.id='fatal' BEGIN SELECT RAISE(ABORT,'fault'); END");
        try{const outcomes=await Promise.allSettled(['before','fatal','after'].map(eventId=>{return item.accept({eventId},destinations);}));assert(outcomes.every(result=>{return result.status==='rejected';}));assert.equal(item.status().ready,false);}finally{db.exec('DROP TRIGGER fail_insert');db.close();}
        const recovered=queue();await recovered.open();assert.equal(recovered.status().pending,0);
    });
    it('rejects oversized input before constructing a decoded queued snapshot',async()=>{
        const item=queue({maxPendingBytes:256});await item.open();const original=JSON.parse;
        JSON.parse=function parse(text,...args){if(text.includes('oversized-marker')){throw new Error('oversized snapshot parsed');}return original(text,...args);};
        try{await assert.rejects(item.accept({eventId:'large',value:'oversized-marker'.repeat(100)},destinations),/byte capacity/u);}finally{Object.assign(JSON,{parse:original});}
        assert.equal(item.status().queuedOperations,0);assert.equal(item.status().pending,0);
    });

    it('retains all confirmed records when a grouped receipt transaction fails',async()=>{
        const item=queue();await item.open();await Promise.all(['a','b'].map(eventId=>{return item.accept({eventId},destinations);}));
        const db=new Database(path.join(directory,'delivery.sqlite'));db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON events WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'receipt fault'); END");
        try{assert.deepEqual(await item.drain(),{delivered:0,failed:2});assert.equal(item.status().ready,false);assert.equal(item.status().queuedOperations,0);}finally{db.exec('DROP TRIGGER fail_delete');db.close();}
        const recovered=queue();await recovered.open();assert.equal(recovered.status().pending,2);
    });
    it('closes with both an accepted sparse append and an in-flight confirmed receipt',async()=>{
        const entered=gate();const confirmed=gate();const item=queue({groupCommit:{maxDelayMs:1000},factory(){return {async write(){entered.resolve();await confirmed.promise;}};}});
        await item.open();const first=item.accept({eventId:'a'},destinations);const flushing=item.drain();await first;await entered.promise;
        const second=item.accept({eventId:'b'},destinations);const closing=item.close();confirmed.resolve();assert.deepEqual(await flushing,{delivered:1,failed:0});await second;await closing;
        const recovered=queue();await recovered.open();assert.equal(recovered.status().pending,1);assert.deepEqual(await recovered.drain(),{delivered:1,failed:0});
    });

});
