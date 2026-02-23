import pubsub from './pubsub.js';

/**
 * Per-machine in-memory timeline segment collection.
 * Stores segments with name, startTime, endTime, duration.
 * Supports relabeling by startTime and streaming events via pubsub.
 *
 * @returns {object} collection with add, relabel, query, stream methods
 *
 * @example
 *   const segs = segments();
 *   segs.add({ name: 'on', startTime: new Date(), endTime: new Date(), duration: 60 });
 *   segs.relabel(startTime, 'heating');
 *   segs.query(); // all segments
 *   segs.query({ from: '2024-01-01', to: '2024-01-02' }); // filtered
 *   const sub = segs.stream((e) => console.log(e));
 *   sub.cancel();
 */
export default function segments() {
    const items = [];
    const bus = pubsub();
    return {
        add(segment) {
            items.push(segment);
            bus.emit({ type: 'created', segment });
        },
        relabel(start, name) {
            const found = items.find((item) => {
                return item.startTime.getTime() === start.getTime();
            });
            if (found) {
                found.name = name;
                bus.emit({ type: 'relabeled', segment: found });
            }
        },
        query(options) {
            if (!options) {
                return items.slice();
            }
            return items.filter((item) => {
                if (options.from && item.endTime < new Date(options.from)) {
                    return false;
                }
                if (options.to && item.startTime > new Date(options.to)) {
                    return false;
                }
                return true;
            });
        },
        stream: bus.stream
    };
}
