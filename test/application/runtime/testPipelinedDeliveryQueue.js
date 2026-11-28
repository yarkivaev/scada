/* eslint-disable no-await-in-loop -- Bounded fixture sequencing. */
import assert from 'node:assert/strict';
import createQueue from '../../../src/application/runtime/deliveryQueue.js';
const target=[{id:'one',type:'amqp'}];
const pause=ms=>{return new Promise(resolve=>{setTimeout(resolve,ms);});};
function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function until(probe, timeoutMs = 500){const end=Date.now()+timeoutMs;while(!probe()){assert(Date.now()<end,'fixture condition deadline');await pause(2);}}
describe('bounded pipelined delivery confirmations',()=>{
 const owned=[];
 function queue(options={}){const value=createQueue({maxBytes:1000000,failureCooldownMs:0,...options});owned.push(value);return value;}
 afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));});
 it('initiates a bounded window in stable order and shares opening before any write',async()=>{
  const opening=gate(); const confirm=gate(); const started=gate();let inFlight=0; let peak=0; let starts=0;const order=[];
  const item=queue({maxInFlight:3,factory(){return {async start(){starts+=1;started.resolve();await opening.promise;},async write(records){inFlight+=1;peak=Math.max(peak,inFlight);order.push(records[0].eventId);await confirm.promise;inFlight-=1;}};}});
  await item.open();await Promise.all(['a','b','c','d','e','f'].map(eventId=>{return item.accept({eventId},target);}));const drain=item.drain();await started.promise;await pause(5);assert.deepEqual(order,[]);opening.resolve();
  try{await until(()=>{return order.length===3;});assert.equal(peak,3);assert.equal(starts,1);}finally{confirm.resolve();}
  assert.deepEqual(await drain,{delivered:6,failed:0});assert.deepEqual(order,['a','b','c','d','e','f']);assert.equal(item.status().pending,0);
 });
 it('refills a confirmed slot while the other publications are still in flight',async function(){
  this.timeout(12000);
  const confirmations = Array.from({length:12}, () => { return gate(); });
  const entered = [];
  let active = 0;
  let peak = 0;
  const item = queue({maxInFlight:4, factory() {
   return {async write(records) {
    const position = Number(records[0].eventId);
    entered.push(position);
    active += 1;
    peak = Math.max(peak, active);
    await confirmations[position].promise;
    active -= 1;
   }};
  }});
  await item.open();
  await Promise.all(Array.from(confirmations.keys(), index => { return item.accept({eventId:String(index)}, target); }));
  const draining = item.drain();
  try {
   await until(() => { return entered.length >= 4; }, 5000);
   assert.deepEqual(entered, [0, 1, 2, 3]);
   confirmations[1].resolve();
   await until(() => { return entered.length >= 5; }, 5000);
   assert.deepEqual(entered, [0, 1, 2, 3, 4]);
   assert.equal(active, 4);
  } finally {
   confirmations.forEach(confirmation => { confirmation.resolve(); });
  }
  assert.deepEqual(await draining, {delivered:12, failed:0});
  assert.equal(peak, 4);
 });
 it('holds actual slots and prospective ACK reservations after caller timeout and fences retries',async()=>{
  const late=gate();let writes=0;const item=queue({maxInFlight:1,maxOperations:1,writeTimeoutMs:15,factory(){return {async write(){writes+=1;await late.promise;},async stop(){}};}});
  await item.open();await item.accept({eventId:'a'},target);assert.equal((await item.drain()).failed,1);assert.equal(item.status().queuedOperations,1);
  assert.equal(writes,1);late.resolve();await until(()=>{return item.status().queuedOperations===0;});assert.equal(item.status().pending,0);
 });
 it('does not reuse an actual publication slot after the caller times out',async()=>{
  const late=gate();const writes=[];
  const item=queue({maxInFlight:1,writeTimeoutMs:20,factory(spec){return {async write(){writes.push(spec.id);await late.promise;},async stop(){}};}});
  await item.open();await item.accept({eventId:'old'},target);
  assert.equal((await item.drain()).failed,1);
  try{
   await item.accept({eventId:'new'},[{id:'other',type:'amqp'}]);
   await item.drain();
   assert.deepEqual(writes,['one']);
  }finally{late.resolve();}
  await until(()=>{return item.status().queuedOperations===0;});
  assert.equal((await item.drain()).delivered,1);
  assert.deepEqual(writes,['one','other']);
 });
 it('aborts real writes on timeout and reopens only after their actual settlement',async()=>{
  let attempts=0; let stops=0;const item=queue({maxInFlight:2,writeTimeoutMs:15,factory(){return {async stop(){stops+=1;},write(records,{signal}){attempts+=1;if(attempts>1){return Promise.resolve();}return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{reject(signal.reason);},{once:true});});}};}});
  await item.open();await item.accept({eventId:'a'},target);assert.equal((await item.drain()).failed,1);await pause(5);assert.equal(item.status().queuedOperations,0);assert.equal((await item.drain()).delivered,1);assert(stops>=1);
 });
 it('retains byte capacity for actual publications rather than only small ACK IDs',async()=>{
  const confirm=gate(); const entered=gate();const item=queue({maxInFlight:4,maxPendingBytes:1800,factory(){return {async write(){entered.resolve();await confirm.promise;}};}});
  await item.open();await item.accept({eventId:'a',body:'x'.repeat(1000)},target);const draining=item.drain();await entered.promise;
  try{assert(item.status().queuedBytes>1000);await assert.rejects(item.accept({eventId:'b',body:'y'.repeat(1000)},target),/byte capacity/u);}finally{confirm.resolve();}await draining;
 });
 it('shares failed opening across waiters and stops only that failed logical session',async()=>{
  const opening=gate();const stopped=[];const received=[];let factories=0;
  const item=queue({factory(spec){factories+=1;return {async start(){if(spec.id==='bad'){await opening.promise;throw new Error('open failed');}},async write(records){received.push(records[0].eventId);},async stop(){stopped.push(spec.id);}};}});
  await item.open();await Promise.all(['a','b'].map(eventId=>{return item.accept({eventId},[{id:'bad',type:'amqp'},...target]);}));const draining=item.drain();await pause(5);opening.resolve();assert.deepEqual(await draining,{delivered:2,failed:2});assert.equal(factories,2);assert.deepEqual(stopped,['bad']);assert.deepEqual(received,['a','b']);assert.equal(item.status().pending,2);
 });
 it('preserves independent same-session outcomes when one mandatory publication returns',async()=>{
  let stopped=false;const item=queue({factory(){return {async write(records){if(records[0].eventId==='bad'){throw new Error('AMQP_UNROUTABLE');}await pause(10);assert.equal(stopped,false);},async stop(){stopped=true;}};}});
  await item.open();await Promise.all(['bad','good'].map(eventId=>{return item.accept({eventId},target);}));assert.deepEqual(await item.drain(),{delivered:1,failed:1});assert.equal(item.status().pending,1);
 });
 it('defaults to32 actual publications and drains larger pages without an unbounded fan-out',async()=>{
  const confirm=gate();let active=0;let peak=0;const item=queue({factory(){return {async write(){active+=1;peak=Math.max(peak,active);await confirm.promise;active-=1;}};}});
  await item.open();await Promise.all(Array.from({length:50},(value,i)=>{return item.accept({eventId:String(i)},target);}));const draining=item.drain();
  try{await until(()=>{return peak===32;});assert.equal(item.status().queuedOperations,32);}finally{confirm.resolve();}assert.deepEqual(await draining,{delivered:50,failed:0});assert.equal(peak,32);
 });
 it('fails close bounded while an actual write is outstanding, then clears the queue after settlement',async()=>{
  const late=gate();const item=queue({writeTimeoutMs:15,maxInFlight:1,factory(){return {async write(){await late.promise;},async stop(){}};}});await item.open();await item.accept({eventId:'a'},target);await item.drain();
  try{await assert.rejects(item.close(),/timed out/u);assert.equal(item.status().pending,1);}finally{late.resolve();}
  await pause(40);await item.close();assert.equal(item.status().pending,0);
 });
 it('retires a late successful opening after timeout without publishing or leaking its resource',async()=>{
  const opening=gate();let live=false;let writes=0;const item=queue({writeTimeoutMs:15,factory(){return {async start(){await opening.promise;live=true;},async stop(){live=false;},async write(){writes+=1;}};}});
  await item.open();await item.accept({eventId:'a'},target);assert.equal((await item.drain()).failed,1);opening.resolve();await until(()=>{return item.status().queuedOperations===0;});assert.equal(item.status().pending,1);await item.close();assert.equal(writes,0);assert.equal(live,false);assert.equal(item.status().pending,0);
 });
 it('does not publish an evicted page member that has not been sent yet',async()=>{
  const entered=gate();const confirmed=gate();const sent=[];
  const item=queue({maxRecords:2,maxInFlight:1,factory(){return {async write(records){sent.push(records[0].eventId);entered.resolve();await confirmed.promise;}};}});
  await item.open();await item.accept({eventId:'old-active'},target);await item.accept({eventId:'old-waiting'},target);
  const draining=item.drain();await entered.promise;
  try{await item.accept({eventId:'new-first'},target);await item.accept({eventId:'new-last'},target);}
  finally{confirmed.resolve();}
  assert.deepEqual(await draining,{delivered:1,failed:0});
  assert.deepEqual(sent,['old-active']);assert.equal(item.status().droppedRecords,2);assert.equal(item.status().pending,2);
 });
 it('rejects invalid publication-window values',()=>{
  for(const maxInFlight of [0,-1,1.1,Infinity,NaN]){assert.throws(()=>{queue({maxInFlight,factory(){}});},/maxInFlight/u);}
 });
});
