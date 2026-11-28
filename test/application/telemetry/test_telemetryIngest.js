import assert from 'node:assert/strict';
import * as core from '@yarkivaev/scada';
const telemetryIngest = core.telemetryIngest;

describe('durable telemetry batches',function() {
    it('cannot accept a batch larger than the broker acknowledgement window',function() {
        assert.throws(()=>{return telemetryIngest('amqp://localhost','fixture',{insertRows(){}},{size:513,prefetch:512,maxWaitMs:1000})},Error,'Cannot reject a stalled acknowledgement window');
    });
    it('cannot fail liveness before startup has reported a storage or broker error',function() {
        assert.equal(telemetryIngest('amqp://localhost','fixture',{insertRows(){}},{clock:()=>{return 1794018137000}}).status().live,true,'Startup incorrectly failed the liveness probe');
    });
    it('cannot keep an exclusive consumer after an uncertain ClickHouse write timeout', async function() {
        const halted = [];
        let writer;
        telemetryIngest('amqp://localhost','fixture',{
            insertRows() {
                const error = new Error('Batch write timed out; outcome uncertain');
                error.code = 'WRITE_TIMEOUT';
                return Promise.reject(error);
            }
        }, {
            halt() { halted.push('WRITE_TIMEOUT'); },
            report() { return undefined; },
            connect(_url,_queue,sink) { writer = sink; return {start() { return undefined; }, stop() { return undefined; }}; }
        });
        await writer.write([{topic:'SENSOR/unit-1/GET/temperature/VALUE',ts:1,value:1}]).catch(() => {});
        assert.deepEqual(halted, ['WRITE_TIMEOUT'], 'Exclusive ingest stayed up after WRITE_TIMEOUT');
    });
});
