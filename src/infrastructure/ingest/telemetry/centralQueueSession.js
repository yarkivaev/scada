/* eslint-disable no-await-in-loop */
import amqpSource from '../../streams/amqpSource.js';
import { decodeBatch, MAX_BATCH_BYTES } from './centralEnvelope.js';

export function centralQueueOptions(policy) {
    return {durable:true,autoDelete:false,arguments:{
        'x-queue-type':'classic','x-single-active-consumer':true,'x-max-length':policy.maxPendingBatches,
        'x-max-length-bytes':policy.queueMaxBytes,'x-overflow':'reject-publish'
    }};
}

/** One unacknowledged envelope prevents a later conflict overtaking a failed head. */
export default function centralQueueSession(settings, projection, diagnostics) {
    return amqpSource(settings.url, settings.queue, {
        async accept(delivery) {
            while(delivery.active()) {
                try {
                    const { records, admittedAt, batchId } = decodeBatch(delivery.content,settings.target);
                    await projection.write(records,{admittedAt,batchId,active:delivery.active});
                    diagnostics.accepted?.();return;
                } catch(error) {
                    diagnostics.failed(error);
                    await new Promise((resolve) => {setTimeout(resolve,250);});
                }
            }
        }
    }, { queueOptions:settings.queueOptions,prefetch:1,exclusive:false,maxMessageBytes:MAX_BATCH_BYTES,maxPendingBytes:MAX_BATCH_BYTES,
        preserveOnCapacity:true,stopTimeoutMs:120000,onError:diagnostics.failed,...(settings.connect&&{connect:settings.connect}) });
}
