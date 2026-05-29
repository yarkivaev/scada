import pubsub from '../../../../domain/shared/pubsub.js';
import stompAlertsInit from './stompAlertsInit.js';
import { build, consume } from './stompAlertsLogic.js';

/**
 * @param {object} hydrate - alert hydration port
 * @param {function} source - STOMP source factory
 * @param {object} translations - rule name map
 * @returns {object} alerts collection
 */
export default function stompAlertsCollection(hydrate, source, translations) {
    const items = [];
    const bus = pubsub();
    const state = { items, bus, counter: 0 };
    let subscription = null;
    return {
        async init() {
            await stompAlertsInit(hydrate, items, state);
            subscription = source({
                accept(raw) {
                    consume(raw, state, translations);
                }
            });
        },
        trigger(message, timestamp, object, name) {
            state.counter += 1;
            const alert = build({ id: state.counter, message, timestamp, machine: object, acknowledged: false, name });
            items.push(alert);
            bus.emit({ type: 'created', alert });
            return alert;
        },
        all(...filters) {
            return items.filter((a) => {
                return filters.every((filter) => {
                    return filter(a);
                });
            });
        },
        find(id) {
            return items.find((a) => {
                return a.id === id;
            });
        },
        stream: bus.stream,
        stop() {
            if (subscription) {
                subscription.stop();
            }
        }
    };
}
