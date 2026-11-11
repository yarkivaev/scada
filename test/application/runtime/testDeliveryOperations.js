import assert from 'node:assert/strict';
import deliveryOperations from '../../../src/application/runtime/deliveryOperations.js';
const pause=ms=>{return new Promise(resolve=>{setTimeout(resolve,ms);});};
function gate(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function factory(apply,options){return deliveryOperations(apply,options);}
const build=(operation,bytes=10)=>{return ()=>{return {operation,bytes};};};

describe('delivery operation batching',()=>{
    it('coalesces before serialization and resolves no caller until the grouped write actually settles',async()=>{
        const entered=gate();const committed=gate();const groups=[];let completed=0;
        const queue=await factory(async operations=>{groups.push(operations);entered.resolve();await committed.promise;return operations.map(()=>{return {ok:true};});},{groupCommit:{maxDelayMs:5}});
        const writes=['a','b','c'].map(id=>{return queue.mutate(build(id)).then(()=>{completed+=1;});});
        await entered.promise;assert.deepEqual(groups,[['a','b','c']]);assert.equal(completed,0);assert.equal(queue.status().operations,3);
        committed.resolve();await Promise.all(writes);assert.equal(completed,3);assert.deepEqual(queue.status(),{operations:0,bytes:0});
    });
    it('counts individual operations and bytes across queued and in-flight groups',async()=>{
        const entered=gate();const committed=gate();
        const queue=await factory(async operations=>{entered.resolve();await committed.promise;return operations.map(()=>{return {ok:true};});},{maxOperations:3,maxPendingBytes:30,groupCommit:{maxRecords:2,maxBytes:20,maxDelayMs:0}});
        const first=queue.mutate(build('a'));const second=queue.mutate(build('b'));await entered.promise;
        const third=queue.mutate(build('c'));await assert.rejects(queue.mutate(build('d')),/capacity/u);
        assert.deepEqual(queue.status(),{operations:3,bytes:30});committed.resolve();await Promise.all([first,second,third]);
        const bytes=await factory(async operations=>{return operations.map(()=>{return {ok:true};});},{maxPendingBytes:15});
        const retained=bytes.mutate(build('a'));await assert.rejects(bytes.mutate(build('b')),/byte capacity/u);await retained;
    });
    it('treats barriers as FIFO flush boundaries and flushes a sparse group without another arrival',async()=>{
        const order=[];const queue=await factory(async operations=>{order.push(...operations);return operations.map(()=>{return {ok:true};});},{groupCommit:{maxDelayMs:10}});
        const first=queue.mutate(build('a'));const barrier=queue.barrier(()=>{order.push('barrier');return 'snapshot';});const second=queue.mutate(build('b'));
        assert.equal(await barrier,'snapshot');await Promise.all([first,second]);assert.deepEqual(order,['a','barrier','b']);
        const sparse=queue.mutate(build('sparse'));await sparse;assert.equal(order.at(-1),'sparse');
    });
    it('retains reservations after a caller deadline and flushes idle without waiting for a sparse timer',async()=>{
        const committed=gate();const entered=gate();
        const queue=await factory(async operations=>{entered.resolve();await committed.promise;return operations.map(()=>{return {ok:true};});},{groupCommit:{maxDelayMs:1000}});
        const actual=queue.mutate(build('a'));const idle=queue.idle();await entered.promise;
        assert.equal(await Promise.race([actual.then(()=>{return 'early';}),pause(5).then(()=>{return 'deadline';})]),'deadline');
        assert.equal(queue.status().operations,1);committed.resolve();await actual;await idle;assert.equal(queue.status().operations,0);
    });
    it('routes individual errors and rejects all callers on a grouped storage failure',async()=>{
        const failure=new Error('conflict');const queue=await factory(async()=>{return [{ok:true},{ok:false,error:failure},{ok:true}];});
        const results=await Promise.allSettled(['a','b','c'].map(id=>{return queue.mutate(build(id));}));
        assert.deepEqual(results.map(item=>{return item.status;}),['fulfilled','rejected','fulfilled']);assert.equal(results[1].reason,failure);
        const fatal=await factory(async()=>{throw new Error('disk');});
        const rejected=await Promise.allSettled(['a','b'].map(id=>{return fatal.mutate(build(id));}));
        assert(rejected.every(item=>{return item.status==='rejected'&&item.reason.message==='disk';}));assert.equal(fatal.status().bytes,0);
    });
    it('rejects invalid limits and oversized operations without retaining input builders',async()=>{
        const apply=async operations=>{return operations.map(()=>{return {ok:true};});};
        for(const options of [{maxOperations:0},{maxPendingBytes:0},{groupCommit:{maxRecords:1.5}},{groupCommit:{maxBytes:0}},{groupCommit:{maxDelayMs:-1}},{groupCommit:null},{groupCommit:[]},{groupCommit:3},{groupCommit:{maxDelayMs:2147483648}}]){
            // eslint-disable-next-line no-await-in-loop
            await assert.rejects(factory(apply,options),/positive|nonnegative|safe|object/iu);
        }
        const queue=await factory(apply,{maxPendingBytes:10});await assert.rejects(queue.mutate(build('big',11)),/byte capacity/u);assert.equal(queue.status().operations,0);
    });
    it('reserves receipt capacity before network publication and only queues its mutation after confirmation',async()=>{
        const groups=[];const queue=await factory(async operations=>{groups.push(operations);return operations.map(()=>{return {ok:true};});},{maxOperations:1});
        const ticket=queue.prepare(build('receipt'));assert.equal(queue.status().operations,1);await assert.rejects(queue.mutate(build('source')),/capacity/u);
        let idle=false;const waiting=queue.idle().then(()=>{idle=true;});await pause(5);assert.equal(idle,false);assert.deepEqual(groups,[]);
        await ticket.commit();await waiting;assert.deepEqual(groups,[['receipt']]);assert.equal(queue.status().operations,0);
        const cancelled=queue.prepare(build('cancelled'));cancelled.cancel();await assert.rejects(cancelled.commit(),/settled/u);assert.equal(queue.status().operations,0);
    });
    it('accounts retained network bytes separately from committed mutation-group bytes',async()=>{
        const queue=await factory(async operations=>{return operations.map(()=>{return {ok:true};});},{maxPendingBytes:1000,groupCommit:{maxBytes:100}});
        const ticket=queue.prepare(()=>{return {operation:'ack',bytes:10,retainedBytes:800};});assert.equal(queue.status().bytes,810);
        await assert.rejects(queue.mutate(build('append',200)),/byte capacity/u);await ticket.commit();assert.deepEqual(queue.status(),{operations:0,bytes:0});
    });
    it('rejects malformed grouped outcomes without releasing any reservation twice',async()=>{
        const queue=await factory(async()=>{return [undefined];});await assert.rejects(queue.mutate(build('a')),/Invalid grouped/u);assert.deepEqual(queue.status(),{operations:0,bytes:0});
    });

});
