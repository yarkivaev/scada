/* eslint-disable no-await-in-loop -- Poll bounded scheduling conditions. */
import assert from 'node:assert/strict';
import queuedDelivery from '../../../src/application/runtime/queuedDelivery.js';
const pause=ms=>{return new Promise(resolve=>{setTimeout(resolve,ms);});};
async function until(probe,timeout=500){const end=Date.now()+timeout;while(!probe()){if(Date.now()>end){throw new Error('Drain continuation deadline');}await pause(5);}}

describe('bounded queued delivery scheduling',()=>{
    it('continues healthy full pages beyond the old 100-record per second ceiling and yields between bursts',async()=>{
        let pending=600;const calls=[];
        const queue={async open(){},async close(){},status(){return {ready:true,pending,drainFull:true};},async drain(){calls.push(Date.now());pending-=100;return {delivered:100,failed:0};}};
        const delivery=queuedDelivery({},null,queue);
        try{await delivery.open();await until(()=>{return calls.length>=6;});assert(calls[4]-calls[3]>=15,'bounded burst must yield before the fifth page');assert.equal(pending,0);}
        finally{await delivery.stop();}
    });
    it('continues healthy progress when another recipient fails',async()=>{
        let calls=0;const queue={async open(){},async close(){},status(){return {ready:true,pending:100,drainFull:true};},async drain(){calls+=1;return {delivered:99,failed:1};}};
        const delivery=queuedDelivery({},null,queue);
        try{await delivery.open();await until(()=>{return calls>0;});await until(()=>{return calls>=6;});assert(calls>=6);}finally{await delivery.stop();}
    });
    it('backs off when a purportedly full page makes no durable progress',async()=>{
        let calls=0;const queue={async open(){},async close(){},status(){return {ready:true,pending:100,drainFull:true};},async drain(){calls+=1;return {delivered:0,failed:0};}};
        const delivery=queuedDelivery({},null,queue);
        try{await delivery.open();await until(()=>{return calls>0;});await pause(60);assert.equal(calls,1);}finally{await delivery.stop();}
    });
});
