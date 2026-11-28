import taskStateMemory from '../../infrastructure/persistence/runtime/taskStateMemory.js';
import queuedDelivery from './queuedDelivery.js';

/** Collector-owned observations and task state are volatile. */
export default function runtimeServices(env, supplied) {
    const secrets = supplied.secrets ?? { get(name) { return env[name]; } };
    const delivery = queuedDelivery(env, secrets, supplied.deliveryQueue, supplied.deliveryStore);
    const local = supplied.stateStore ? undefined : taskStateMemory();
    return { ...supplied, secrets, deliveryQueue: delivery.queue,
        open() { return delivery.open(); },
        stateStore: supplied.stateStore ?? local,
        async close() {
            try { await delivery.stop(); }
            finally { local?.close(); }
        }
    };
}
