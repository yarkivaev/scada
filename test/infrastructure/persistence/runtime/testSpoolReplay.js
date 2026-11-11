import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,symlink,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import spoolFactory from '../../../../src/infrastructure/persistence/runtime/deliverySpool.js';
import {format} from '../../../../src/infrastructure/persistence/runtime/spoolFormat.js';

describe('disposable recipient replay index',()=>{
 let directory;const owned=[];
 function spool(){const value=spoolFactory(directory,{maxBytes:1000000});owned.push(value);return value;}
 beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'replay-index-'));});
 afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));await rm(directory,{recursive:true,force:true});});
 const destinations=[{id:'a',type:'amqp',url:'amqp://a'},{id:'b',type:'amqp',url:'amqp://b'}];
 it('rebuilds a corrupted disposable index from canonical partial confirmations and preserves v1 rollback',async()=>{
  const first=spool();await first.open();await first.append({eventId:'point',destinations},['a','b']);await first.ack('point','a');await first.close();
  const canonical=new Database(path.join(directory,'delivery.sqlite'),{readonly:true});assert.equal(format(canonical),true);assert.equal(canonical.pragma('user_version',{simple:true}),1);canonical.close();
  await writeFile(path.join(directory,'replay-index.sqlite'),'crash-corrupted-disposable-index');
  const next=spool();await next.open();const rows=await next.pendingFair(100);assert.equal(rows.length,1);assert.deepEqual(rows[0].remaining,['b']);assert.deepEqual(rows[0].event.destinations,destinations);await next.ack('point','b');assert.deepEqual(await next.pendingFair(100),[]);
  assert.equal((await stat(path.join(directory,'replay-index.sqlite'))).mode % 0o1000,0o600);
 });
 it('indexes canonical legacy events without descriptors and removes completed target metadata',async()=>{
  const first=spool();await first.open();await first.append({eventId:'legacy'},['a','b']);await first.ack('legacy','a');await first.close();
  const next=spool();await next.open();assert.deepEqual((await next.pendingFair(1))[0].remaining,['b']);await next.ack('legacy','b');await next.close();
  const index=new Database(path.join(directory,'replay-index.sqlite'),{readonly:true});assert.equal(index.prepare('SELECT COUNT(*) AS count FROM targets').get().count,0);assert.equal(index.prepare('SELECT COUNT(*) AS count FROM pending').get().count,0);index.close();
 });
 it('rejects aliases at the disposable path before modifying any target bytes',async()=>{
  const first=spool();await first.open();await first.append({eventId:'point'},['a']);await first.close();
  await rm(path.join(directory,'replay-index.sqlite'));const other=path.join(directory,'unrelated');await writeFile(other,'keep');await symlink(other,path.join(directory,'replay-index.sqlite'));
  await assert.rejects(spool().open(),/regular|symlink/u);assert.equal(await readFile(other,'utf8'),'keep');
 });
 it('keeps destination and recipient selection indexed',async()=>{
  const first=spool();await first.open();await first.append({eventId:'point',destinations},['a','b']);await first.close();
  const index=new Database(path.join(directory,'replay-index.sqlite'),{readonly:true});
  const explain=sql=>{return index.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map(row=>{return row.detail;}).join(' ');};
  assert.match(explain('SELECT id FROM targets ORDER BY sequence LIMIT 100'),/target_sequence/u);
  assert.match(explain("SELECT event_id,recipient FROM pending WHERE target='x' ORDER BY sequence LIMIT 100"),/SEARCH pending USING PRIMARY KEY/u);
  assert.match(explain("SELECT target FROM pending WHERE event_id='point' AND recipient='a'"),/event_recipient/u);index.close();
 });
});
