import queueFactory from '../../../src/application/runtime/deliveryQueue.js';
const directory=process.argv[2];
const targets=[{id:'one',type:'amqp'}];
const pending=[];
const queue=queueFactory(directory,{maxBytes:100000,factory(){return {write(records){if(records[0].eventId==='confirmed'){return Promise.resolve();}return new Promise(resolve=>{pending.push(resolve);});}};}});
await queue.open();
await Promise.all(['confirmed','uncertain-one','uncertain-two'].map(eventId=>{return queue.accept({eventId,body:Buffer.from(`frozen-${eventId}`)},targets);}));
void queue.drain();
const timer=setInterval(()=>{
    if(queue.status().pending===2&&pending.length===2){clearInterval(timer);process.send('one-receipt-committed-two-publishes-pending');}
},5);
