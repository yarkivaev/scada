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
 *   chron.get(); // { start, end, initial, weight }
 *   chron.get(someTime); // state at specific time
 */
export default function meltingChronology(machine, start, end) {
    return {
        get(datetime) {
            const machineChron = machine.chronology();
            const defaultTime = end === undefined ? new Date() : end;
            const queryTime = datetime === undefined ? defaultTime : datetime;
            const initial = machineChron.get(start).weight;
            const current = machineChron.get(queryTime).weight;
            const result = {
                start,
                initial,
                weight: current
            };
            if (end !== undefined) {
                result.end = end;
            }
            return result;
        }
    };
}
