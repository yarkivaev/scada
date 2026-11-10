import {createClient} from '@clickhouse/client';
import metricsRelation,{rawMetricsRelation} from './metricsRelation.js';
import nativeMetricsSchema from './nativeMetricsSchema.js';
import nativeMetricsOwnership from './nativeMetricsOwnership.js';
import nativeMetricsAdmission from './nativeMetricsAdmission.js';
import nativeMetricsCompaction from './nativeMetricsCompaction.js';
export {LEGACY_METRICS_SQL,NATIVE_METRICS_SQL} from './nativeMetricsSchema.js';
/** Only the serialized SAC head may use this admission writer. */
export default function canonicalMetrics(url,domain,options={}) {
    const client=createClient({url,request_timeout:10000});let cleaning;let ready;let timer;
    function runCompaction(){
        cleaning??=nativeMetricsCompaction(client,options).finally(()=>{cleaning=undefined;});
        return cleaning;
    }
    function start(context){
        nativeMetricsOwnership(context);
        ready??=nativeMetricsSchema(client,domain,metricsRelation,rawMetricsRelation).then(()=>{
            nativeMetricsOwnership(context);
            if((options.cleanupIntervalMs??30000)>0){timer=setInterval(()=>{runCompaction().catch(error=>{options.onCleanupError?.(error);});},options.cleanupIntervalMs??30000);timer.unref();}
        }).catch(error=>{ready=undefined;throw error;});
        return ready;
    }
    return {start,async write(records,context){await start(context);nativeMetricsOwnership(context);await nativeMetricsAdmission(client,records,context,options);},
        async runCompaction(){await start();return runCompaction();},
        async stop(){clearInterval(timer);if(cleaning){await Promise.allSettled([cleaning]);}await client.close();}};
}
