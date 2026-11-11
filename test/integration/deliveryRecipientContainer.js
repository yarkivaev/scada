/* eslint-disable no-await-in-loop, no-loop-func, require-atomic-updates -- Bounded real-broker fixture admission and polling. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import amqp from 'amqplib';
import {GenericContainer,Wait} from 'testcontainers';
import createQueue from '../../src/application/runtime/deliveryQueue.js';
import queuedDelivery from '../../src/application/runtime/queuedDelivery.js';
import amqpSink from '../../src/infrastructure/streams/amqpSink.js';

async function until(probe){const deadline=Date.now()+10000;while(!await probe()){assert(Date.now()<deadline,'healthy receiver must not wait for the offline backlog');await new Promise(resolve=>{setTimeout(resolve,20);});}}
describe('recipient-isolated replay with real RabbitMQ',function integration(){
 this.timeout(120000);
 let rabbit;let directory;let connection;let channel;let delivery;let queue;
 after(async()=>{await delivery?.stop();await queue?.close();await channel?.close().catch(()=>{});await connection?.close().catch(()=>{});await rabbit?.stop();if(directory){await rm(directory,{recursive:true,force:true});}});
 it('drains healthy mandatory confirms while retaining1000 offline events across restart',async()=>{
  rabbit=await new GenericContainer('rabbitmq:3.13-management').withEnvironment({RABBITMQ_DEFAULT_USER:'test',RABBITMQ_DEFAULT_PASS:'test'}).withExposedPorts(5672).withWaitStrategy(Wait.forListeningPorts()).start();
  const url=`amqp://test:test@${rabbit.getHost()}:${rabbit.getMappedPort(5672)}`;
  connection=await amqp.connect(url);connection.on('error',()=>{});channel=await connection.createChannel();channel.on('error',()=>{});await channel.assertQueue('healthy',{durable:true});
  directory=await mkdtemp(path.join(os.tmpdir(),'recipient-real-broker-'));
  const options={maxBytes:10000000,writeTimeoutMs:1000,factory(spec){return amqpSink(spec.url,{connectTimeoutMs:250,retryMs:10000,onError(){}});}};
  queue=createQueue(directory,options);await queue.open();
  const bad=[{id:'owner',type:'amqp',url:'amqp://127.0.0.1:1'}];const good=[{id:'owner',type:'amqp',url}];
  for(let start=0;start<1000;start+=64){await Promise.all(Array.from({length:Math.min(64,1000-start)},(unused,i)=>{return queue.accept({eventId:`offline-${start+i}`,exchange:'',routingKey:'healthy',body:Buffer.from('retained')},bad);}));}
  for(let start=0;start<300;start+=64){await Promise.all(Array.from({length:Math.min(64,300-start)},(unused,i)=>{return queue.accept({eventId:`healthy-${start+i}`,exchange:'',routingKey:'healthy',body:Buffer.from(`value-${start+i}`)},good);}));}
  delivery=queuedDelivery({},null,queue);await delivery.open();await until(()=>{return queue.status().pending===1000;});assert.equal((await channel.checkQueue('healthy')).messageCount,300);
  const ids=new Set();for(let i=0;i<300;i+=1){const message=await channel.get('healthy',{noAck:true});assert(message);assert.equal(message.content.toString(),`value-${Number(message.properties.messageId.slice(8))}`);ids.add(message.properties.messageId);}assert.equal(ids.size,300);
  await delivery.stop();delivery=null;queue=createQueue(directory,options);await queue.open();assert.equal(queue.status().pending,1000);await queue.drain();assert.equal(queue.status().pending,1000);assert.equal((await channel.checkQueue('healthy')).messageCount,0);
 });
});
