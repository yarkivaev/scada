import { createClient } from '@clickhouse/client';
import amqp from 'amqplib';
import centralPolicy from './centralPolicy.js';

async function queueExists(url,queue) {
    const connection = await amqp.connect(url,{timeout:5000});
    const channel = await connection.createChannel();
    channel.on('error',() => { return undefined; });
    try {
        try { await channel.checkQueue(queue); return true; }
        catch (error) { if (error.code !== 404) { throw error; } return false; }
    } finally { await connection.close(); }
}
async function activated(url) {
    const client = createClient({url,request_timeout:10000});
    try {
        const result = await client.query({query:"SELECT name FROM system.tables WHERE database='scada' AND name IN ('metrics_points_v4','metrics_points_v3','metrics_compact_v2','metrics_canonical')",format:'JSONEachRow'});
        return (await result.json()).length>0;
    } finally { await client.close(); }
}
/** A persistent queue or table pins activation even before the first insertion. */
export default async function centralTelemetryPreflight(env) {
    const policy = centralPolicy(env.CENTRAL_TELEMETRY_POLICY ?? {});
    if (policy.enabled) { return; }
    if (env.CENTRAL_TELEMETRY_POLICY && !env.AMQP_URL) { throw new Error('Disabled explicit central policy requires AMQP_URL to check canonical activation'); }
    const url = env.CLICKHOUSE_URL || (env.CLICKHOUSE_HOST ? `http://${env.CLICKHOUSE_HOST}:8123` : undefined);
    if (!url) { return; }
    if (await activated(url) || (env.AMQP_URL && await queueExists(env.AMQP_URL,policy.queue))) {
        throw new Error('Central telemetry policy cannot be disabled after canonical queue or table activation');
    }
}
