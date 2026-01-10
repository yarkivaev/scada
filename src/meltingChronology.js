/**
 * Melting chronology bound to a machine.
 * Derives values from machine's weight history during the melting window.
 *
 * @param {object} machine - melting machine with chronology method
 * @param {Date} start - melting start time
 * @param {Date} end - melting end time (undefined for active meltings)
 * @returns {object} chronology with get method
 *
 * @example
 *   const chron = meltingChronology(machine, startTime, endTime);
 *   chron.get(); // { start, end, initial, weight, loaded, dispensed }
 *   chron.get(someTime); // state at specific time
 */
export default function meltingChronology(machine, start, end) {
    return {
        get(datetime) {
            const machineChron = machine.chronology();
            const defaultTime = end === undefined ? new Date() : end;
            const queryTime = datetime === undefined ? defaultTime : datetime;
            const initial = machineChron.get({ type: 'point', at: start }).weight;
            const current = machineChron.get({ type: 'point', at: queryTime }).weight;
            const range = machineChron.get({ type: 'range', from: start, to: queryTime });
            const result = {
                start,
                initial,
                weight: current,
                loaded: range.loaded,
                dispensed: range.dispensed
            };
            if (end !== undefined) {
                result.end = end;
            }
            return result;
        }
    };
}
