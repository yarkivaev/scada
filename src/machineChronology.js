/**
 * Immutable chronology that queries shared machine weight history.
 * Returns weight at current time or at a specific historical datetime.
 *
 * @param {number} initial - initial weight when machine was created
 * @param {array} history - shared mutable array of { timestamp, weight } entries
 * @returns {object} chronology with get method
 *
 * @example
 *   const history = [{ timestamp: new Date(), weight: 0 }];
 *   const chron = machineChronology(0, history);
 *   chron.get().weight; // current weight
 *   chron.get(someDate).weight; // weight at someDate
 */
export default function machineChronology(initial, history) {
    return {
        get(datetime) {
            if (datetime !== undefined) {
                const time = new Date(datetime).getTime();
                for (let i = history.length - 1; i >= 0; i -= 1) {
                    if (history[i].timestamp.getTime() <= time) {
                        return { weight: history[i].weight };
                    }
                }
                return { weight: initial };
            }
            return { weight: history[history.length - 1].weight };
        }
    };
}
