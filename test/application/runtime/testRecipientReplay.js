/* eslint-disable no-await-in-loop -- Durable fixture admission is intentionally ordered. */
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import createQueue from '../../../src/application/runtime/deliveryQueue.js';

const bad={id:'owner',type:'amqp',url:'amqp://offline'};
const good={id:'owner',type:'amqp',url:'amqp://healthy'};
describe('recipient-isolated durable replay',()=>{
 let directory;const owned=[];
 function queue(options={}){const value=createQueue(directory,{maxBytes:10000000,groupCommit:{maxDelayMs:0},...options});owned.push(value);return value;}
 beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'recipient-replay-'));});
 afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));await rm(directory,{recursive:true,force:true});});
 it('reaches a healthy immutable destination in the first page behind1000 offline-only events',async()=>{
  const received=[];const item=queue({factory(spec){return {async write(records){if(spec.url===bad.url){throw new Error('offline');}received.push(records[0].eventId);}};}});
  await item.open();
  for(let i=0;i<1000;i+=1){await item.accept({eventId:`offline-${i}`},[bad]);}
  await item.accept({eventId:'healthy-now'},[good]);
  await item.drain();assert.deepEqual(received,['healthy-now']);assert.equal(item.status().pending,1000);
 });
 it('cools down only the failed descriptor, keeps healthy work moving, and retries after expiry',async()=>{
  let now=0;let offline=true;let attempts=0;const received=[];
  const item=queue({clock(){return now;},failureCooldownMs:10000,batchSize:2,factory(spec){return {async write(records){if(spec.url===bad.url){attempts+=1;if(offline){throw new Error('offline');}}received.push(records[0].eventId);}};}});
  await item.open();await item.accept({eventId:'old'},[bad]);await item.drain();
  await item.accept({eventId:'new'},[good]);await item.drain();assert.deepEqual(received,['new']);assert.equal(attempts,1);
  offline=false;now=10001;await item.drain();assert.deepEqual(received,['new','old']);assert.equal(item.status().pending,0);
 });
 it('reuses settled sessions after64 failed immutable descriptors',async()=>{
  let now=0;const received=[];const item=queue({clock(){return now;},factory(spec){return {async write(records){if(spec.url!==good.url){throw new Error('offline');}received.push(records[0].eventId);},async stop(){}};}});
  await item.open();for(let i=0;i<64;i+=1){await item.accept({eventId:`bad-${i}`},[{...bad,url:`amqp://offline-${i}`}]);}
  await item.accept({eventId:'healthy'},[good]);await item.drain();now=10001;await item.drain();assert.deepEqual(received,['healthy']);assert.equal(item.status().pending,64);
 });
 it('reuses fully settled successful sessions after64 descriptor rotations',async()=>{
  const received=[];let stopped=0;const item=queue({factory(){return {async write(records){received.push(records[0].eventId);},async stop(){stopped+=1;}};}});
  await item.open();for(let i=0;i<65;i+=1){await item.accept({eventId:`rotation-${i}`},[{...good,url:`amqp://healthy-${i}`}]);await item.drain();}
  assert.equal(received.length,65);assert.equal(item.status().pending,0);assert(stopped>=1);
 });

});
