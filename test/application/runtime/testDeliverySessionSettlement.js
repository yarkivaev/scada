/* eslint-disable no-await-in-loop -- Bounded fixture polling. */
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import queueFactory from '../../../src/application/runtime/deliveryQueue.js';
import amqpSink from '../../../src/infrastructure/streams/amqpSink.js';
const pause=ms=>{return new Promise(resolve=>{setTimeout(resolve,ms);});};
async function until(probe){const end=Date.now()+500;while(!probe()){assert(Date.now()<end,'fixture deadline');await pause(2);}}
function broker(){
 const sent=[];const confirmations=[];const channel=Object.assign(new EventEmitter(),{publish(exchange,routingKey,body,options,callback){sent.push({exchange,routingKey,body,options});confirmations.push(callback);return true;},close(){channel.emit('close');return Promise.resolve();}});
 const connection=Object.assign(new EventEmitter(),{createConfirmChannel(){return Promise.resolve(channel);},close(){connection.emit('close');return Promise.resolve();}});
 return {sent,confirmations,connection,channel};
}
const recipients=[{id:'owner',type:'amqp',url:{$secret:'AMQP_URL_OWNER'}}];
function event(eventId){return {eventId,exchange:'events',routingKey:'point',body:Buffer.from(`exact-${eventId}`)};}
describe('queue with actual AMQP publication settlement',()=>{
 let directory;const owned=[];
 function queue(options={}){const value=queueFactory(directory,{maxBytes:100000,failureCooldownMs:0,...options});owned.push(value);return value;}
 beforeEach(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'queue-actual-sink-'));});
 afterEach(async()=>{await Promise.all(owned.splice(0).map(item=>{return item.close();}));await rm(directory,{recursive:true,force:true});});
 it('fences a late confirmation after caller abort and retries with rotated credentials on a fresh session',async()=>{
  const fixtures=[];const resolved=[];let password='old';const item=queue({writeTimeoutMs:20,factory(){const fixture=broker();fixtures.push(fixture);resolved.push(password);return amqpSink('amqp://test',{connect(){return Promise.resolve(fixture.connection);},retryMs:10000,onError(){}});}});
  await item.open();await item.accept(event('a'),recipients);assert.deepEqual(await item.drain(),{delivered:0,failed:1});await pause(5);assert.equal(item.status().queuedOperations,0);
  fixtures[0].confirmations[0](null);await pause(5);assert.equal(item.status().pending,1);password='rotated';const draining=item.drain();await until(()=>{return fixtures[1]?.confirmations.length===1;});fixtures[1].confirmations[0](null);assert.deepEqual(await draining,{delivered:1,failed:0});assert.deepEqual(resolved,['old','rotated']);assert.equal(item.status().pending,0);
 });
 it('keeps individual mandatory returns separate while concurrent confirms succeed',async()=>{
  const fixture=broker();const item=queue({factory(){return amqpSink('amqp://test',{connect(){return Promise.resolve(fixture.connection);},onError(){}});}});
  await item.open();await Promise.all(['first','returned','last'].map(id=>{return item.accept(event(id),recipients);}));const draining=item.drain();await until(()=>{return fixture.sent.length===3;});assert.equal(item.status().pending,3);
  fixture.channel.emit('return',{properties:{headers:fixture.sent[1].options.headers},fields:{replyText:'NO_ROUTE'}});fixture.confirmations.forEach(callback=>{callback(null);});assert.deepEqual(await draining,{delivered:2,failed:1});assert.equal(item.status().pending,1);assert.deepEqual(fixture.sent.map(record=>{return record.options.messageId;}),['first','returned','last']);
 });
 it('replays only unacknowledged exact observations after SIGKILL during a pipelined drain',async function(){
  this.timeout(10000);const child=fork(new URL('../../helpers/runtime/queueConfirmChild.js',import.meta.url),[directory],{silent:true});
  try{const [message]=await once(child,'message');assert.equal(message,'one-receipt-committed-two-publishes-pending');}finally{const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
  const received=[];const item=queue({factory(){return {async write(records){received.push([records[0].eventId,records[0].body.toString()]);}};}});await item.open();assert.equal(item.status().pending,2);assert.deepEqual(await item.drain(),{delivered:2,failed:0});assert.deepEqual(received,[['uncertain-one','frozen-uncertain-one'],['uncertain-two','frozen-uncertain-two']]);
 });
 it('waits for confirmations and durable receipts before close releases storage ownership',async()=>{
  const fixture=broker();const item=queue({factory(){return amqpSink('amqp://test',{connect(){return Promise.resolve(fixture.connection);},onError(){}});}});
  await item.open();await Promise.all(['a','b'].map(id=>{return item.accept(event(id),recipients);}));const draining=item.drain();await until(()=>{return fixture.sent.length===2;});let closed=false;const closing=item.close().then(()=>{closed=true;});await pause(5);assert.equal(closed,false);fixture.confirmations.forEach(callback=>{callback(null);});assert.deepEqual(await draining,{delivered:2,failed:0});await closing;
  const recovered=queue({factory(){throw Error('not needed');}});await recovered.open();assert.equal(recovered.status().pending,0);fixture.confirmations.forEach(callback=>{callback(null);});await pause(5);assert.equal(recovered.status().pending,0);
 });
});
