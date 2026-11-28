import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as core from '@yarkivaev/scada';
const telemetryBackfill = core.telemetryBackfill;

function bits(value) {const b=Buffer.alloc(8);b.writeDoubleBE(value);return b.readBigUInt64BE().toString();}
function sourcePort(rows, afterPage=()=>{}) {
    const cursors=new Map();
    return {
        async nextTopic(after) {return [...new Set(rows.map(row=>{return row.topic}))].sort().find(topic=>{return after===null||topic>after}) ?? null;},
        async upper(topic) {
            const snapshot=rows.filter(row=>{return row.topic===topic}).sort((a,b)=>{return a.ts.localeCompare(b.ts)||Number(BigInt(bits(a.value))-BigInt(bits(b.value)))});
            cursors.set(topic,{snapshot,position:0});return snapshot.at(-1)?.ts ?? null;
        },
        async page(topic,after,upper,size) {
            const cursor=cursors.get(topic);
            const page=cursor.snapshot.slice(cursor.position,cursor.position+size);cursor.position+=page.length;
            afterPage(page);return page;
        }
    };
}

function targetPort(initial=[]) {
    const rows=[...initial];
    return {
        rows,
        async insertRows(batch) {rows.push(...batch.map(row=>{return {...row}}));},
        async canonical(topic,first,last) {
            const groups=new Map();
            for(const row of rows.filter(item=>{return item.topic===topic&&item.ts>=first&&item.ts<=last})) {
                const list=groups.get(row.ts)||[];list.push(row);groups.set(row.ts,list);
            }
            return [...groups].map(([ts,list])=>{return {ts,valueBits:[...new Set(list.map(item=>{return bits(item.value)}))]}});
        }
    };
}
const row=(topic,second,value=1)=>{return {topic,ts:`2026-11-08 01:02:${second}`,value}};

describe('telemetryBackfill',function(){
    it('copies every topic in bounded ordered pages preserving six timestamp digits',async function(){
        const rows=[row('B','03.123457',4),row('A','03.123456',2),row('A','03.123457',3),row('A','04.000001',5)];
        const target=targetPort();const pages=[];
        const report=await telemetryBackfill({source:sourcePort(rows,page=>{return pages.push(page.length)}),target},{mode:'copy',pageSize:2});
        assert.equal(report.sourceCount,4);assert.equal(report.topics,2);assert.deepEqual(pages,[2,1,0,1,0]);
        assert.deepEqual(target.rows.map(r=>{return r.ts}),[rows[1].ts,rows[2].ts,rows[3].ts,rows[0].ts]);
    });
    it('makes restart from zero safe after an uncertain committed insert',async function(){
        const rows=[row('A','03.000001'),row('A','04.000001')];const target=targetPort();let fail=true;
        const insert=target.insertRows;
        target.insertRows=async batch=>{await insert(batch);if(fail){fail=false;throw new Error('uncertain commit');}};
        await assert.rejects(telemetryBackfill({source:sourcePort(rows),target},{mode:'copy',pageSize:1}),/uncertain commit/u);
        const copy=await telemetryBackfill({source:sourcePort(rows),target},{mode:'copy',pageSize:1});
        const verify=await telemetryBackfill({source:sourcePort(rows),target},{mode:'verify',pageSize:1});
        assert.equal(target.rows.length,3);assert.equal(verify.sourceCount,2);assert.equal(copy.digest,verify.digest);
    });
    it('repairs late source inserts missed behind an initial copy cursor and allows extra live rows',async function(){
        const rows=[row('A','03.000001'),row('A','05.000001')];let late=false;
        const source=sourcePort(rows,page=>{if(page[0]?.ts.endsWith('05.000001')&&!late){late=true;rows.push(row('A','04.000001',7));}});
        const target=targetPort([row('A','04.500001',8)]);
        await telemetryBackfill({source,target},{mode:'copy',pageSize:1});
        await assert.rejects(telemetryBackfill({source,target},{mode:'verify',pageSize:2}),/Missing/u);
        const report=await telemetryBackfill({source,target},{mode:'repair',pageSize:2});
        assert.equal(report.sourceCount,3);assert.equal(report.missingRepaired,1);assert.equal(report.conflictCount,0);
    });
    it('cannot discard stored variants when the expected source bits are present',async function(){
        const source=sourcePort([row('A','03.000001',9)]);const target=targetPort([row('A','03.000001',9),row('A','03.000001',8)]);
        const report=await telemetryBackfill({source,target},{mode:'verify'});
        assert.deepEqual([report.sourceCount,report.conflictCount,target.rows.length],[1,0,2],'Stored value variants were rejected or discarded');
    });
    it('cannot replace another raw variant when repairing missing source bits',async function(){
        const target=targetPort([row('A','03.000001',10)]);
        const source=sourcePort([row('A','03.000001',9)]);
        await assert.rejects(telemetryBackfill({source,target},{mode:'verify'}),/Missing/u);
        await telemetryBackfill({source,target},{mode:'repair'});
        assert.deepEqual(target.rows.map(item=>{return item.value}),[10,9],'Repair replaced a different raw variant');
    });
    it('cannot skip physical duplicates or same timestamp variants across page boundaries',async function(){
        const rows=[row('A','03.000001',9),row('A','03.000001',8),row('A','03.000001',9),row('A','03.000001',7),row('A','04.000001',2)];
        const target=targetPort();const source=sourcePort(rows);
        const copied=await telemetryBackfill({source,target},{mode:'copy',pageSize:2});
        const verified=await telemetryBackfill({source,target},{mode:'verify',pageSize:2});
        const replayed=await telemetryBackfill({source,target},{mode:'copy',pageSize:2});
        assert.deepEqual({count:copied.sourceCount,physical:target.rows.length,values:target.rows.slice(0,5).map(item=>{return item.value}),stable:copied.digest===verified.digest&&copied.digest===replayed.digest},
            {count:5,physical:10,values:[7,8,9,9,2],stable:true},'Duplicate source rows or variants disappeared across a page boundary');
    });
    it('rereads repaired rows and rejects an unsuccessful repair',async function(){
        const target=targetPort();target.insertRows=async()=>{};
        await assert.rejects(telemetryBackfill({source:sourcePort([row('A','03.000001')]),target},{mode:'repair'}),/Missing/u);
    });
    it('hashes topic UTF8 length, exact epoch microseconds and IEEE754 bits deterministically',async function(){
        const sample=row('Тема','03.123456',-0);const target=targetPort();
        const report=await telemetryBackfill({source:sourcePort([sample]),target},{mode:'copy'});
        const topic=Buffer.from(sample.topic);const length=Buffer.alloc(4);length.writeUInt32BE(topic.length);
        const time=Buffer.alloc(8);time.writeBigInt64BE(BigInt(Date.parse('2026-11-08T01:02:03.123Z'))*1000n+456n);
        const value=Buffer.alloc(8);value.writeDoubleBE(-0);
        assert.equal(report.digest,createHash('sha256').update(length).update(topic).update(time).update(value).digest('hex'));
    });
});
