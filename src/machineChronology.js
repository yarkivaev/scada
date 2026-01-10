/**
 * Immutable chronology that queries shared machine weight history.
 * Supports point-in-time and range queries via query object.
 *
 * @param {number} initial - initial weight when machine was created
 * @param {array} history - shared mutable array of { timestamp, weight } entries
 * @returns {object} chronology with get method
 *
 * @example
 *   const history = [{ timestamp: new Date(), weight: 0 }];
 *   const chron = machineChronology(0, history);
 *   chron.get({ type: 'current' }).weight; // current weight
 *   chron.get({ type: 'point', at: someDate }).weight; // weight at someDate
 *   chron.get({ type: 'range', from: start, to: end }); // { loaded, dispensed }
 */
export default function machineChronology(initial, history) {
    function current() {
        return { weight: history[history.length - 1].weight };
    }
    function point(datetime) {
        const time = new Date(datetime).getTime();
        for (let i = history.length - 1; i >= 0; i -= 1) {
            if (history[i].timestamp.getTime() <= time) {
                return { weight: history[i].weight };
            }
        }
        return { weight: initial };
    }
    function range(from, to) {
        const start = new Date(from).getTime();
        const end = new Date(to).getTime();
        const entries = history.filter((entry) => {
            const time = entry.timestamp.getTime();
            return time >= start && time < end;
        });
        let loaded = 0;
        let dispensed = 0;
        const base = point(from).weight;
        let previous = base;
        for (const entry of entries) {
            const delta = entry.weight - previous;
            if (delta > 0) {
                loaded += delta;
            } else if (delta < 0) {
                dispensed += Math.abs(delta);
            }
            previous = entry.weight;
        }
        return { loaded, dispensed };
    }
    return {
        get(query) {
            if (query.type === 'current') {
                return current();
            }
            if (query.type === 'point') {
                return point(query.at);
            }
            if (query.type === 'range') {
                return range(query.from, query.to);
            }
            throw new Error(`Unknown query type: ${query.type}`);
        }
    };
}
