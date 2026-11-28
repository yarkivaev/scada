import amqpSink from '../infrastructure/streams/amqpSink.js';
import { deliverHistoryReplica, historyReplication } from '../infrastructure/persistence/pg/historyReplicaOutbox.js';
import processingErrorLog from '../infrastructure/ingest/processingErrorLog.js';

export default function historyReplicaRelay(url, pool) {
    function report(error) { processingErrorLog('history_replica_outbox', error, {}); }
    const publisher = amqpSink(url, { onError: report });
    let stopped = true;
    let timer;
    let pending = Promise.resolve();

    function poll(delay) {
        if (stopped) { return; }
        timer = setTimeout(() => {
            pending = (publisher.active() ? deliverHistoryReplica(pool, record => {
                return publisher.write([record]);
            }) : Promise.resolve({ found: false })).then(({ found, error }) => {
                if (error) { report(error); }
                poll(found ? 0 : 1000);
            }, error => { report(error); poll(1000); });
        }, delay).unref();
    }

    return {
        history(store) {
            return {
                ...store,
                commitOutbox(machine, workId, segments, context, replication) {
                    return store.commit(machine, workId, segments, { ...context, replication: historyReplication(replication) });
                }
            };
        },
        start() {
            if (!stopped) { return; }
            stopped = false;
            void publisher.start().catch(report);
            poll(0);
        },
        async stop() {
            stopped = true;
            clearTimeout(timer);
            await publisher.stop();
            await pending;
        }
    };
}
