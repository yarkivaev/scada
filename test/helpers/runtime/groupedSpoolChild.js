import deliverySpool from '../../../src/infrastructure/persistence/runtime/deliverySpool.js';
import deliveryQueue from '../../../src/application/runtime/deliveryQueue.js';
const directory=process.argv[2];
if(process.argv[3]==='buffered') {
    const queue=deliveryQueue(directory,{maxBytes:100000,groupCommit:{maxDelayMs:60000},factory(){throw new Error('offline');}});
    await queue.open();
    void queue.accept({eventId:'a'},[{id:'one',type:'amqp'}]);void queue.accept({eventId:'b'},[{id:'one',type:'amqp'}]);
    process.send('buffered');
} else {
    const spool=deliverySpool(directory,{maxBytes:100000});await spool.open();
    await spool.mutateMany([{kind:'append',event:{eventId:'a',body:Buffer.from('frozen')},recipients:['one','two']},
        {kind:'append',event:{eventId:'b'},recipients:['one']},{kind:'ack',eventId:'a',recipient:'one'}]);
    process.send('committed');
}
setInterval(()=>{},1000);
