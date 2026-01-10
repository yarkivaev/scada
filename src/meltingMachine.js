import machineChronology from './machineChronology.js';

/**
 * Melting machine that tracks metal weight history and sensor measurements.
 * Supports loading and dispensing metal during melting operations.
 * Weight history is tracked for historical queries.
 *
 * @param {string} name - unique machine identifier
 * @param {object} sensors - object containing sensor instances
 * @param {object} alerts - centralized alerts collection
 * @param {number} initial - initial weight (defaults to 0)
 * @returns {object} machine with name, sensors, alerts, chronology, load, dispense
 *
 * @example
 *   const machine = meltingMachine('icht1', { voltage: voltageSensor() }, alerts());
 *   machine.load(500);
 *   machine.chronology().get().weight; // 500
 *   machine.chronology().get(pastDate).weight; // weight at pastDate
 */
export default function meltingMachine(name, sensors, alerts, initial) {
    const start = initial === undefined ? 0 : initial;
    const history = [{ timestamp: new Date(), weight: start }];
    let current = start;
    return {
        name() {
            return name;
        },
        sensors,
        alerts() {
            return alerts.all((item) => {
                return item.object === name;
            });
        },
        chronology() {
            return machineChronology(start, history);
        },
        load(w) {
            current += w;
            history.push({ timestamp: new Date(), weight: current });
        },
        dispense(w) {
            current -= w;
            history.push({ timestamp: new Date(), weight: current });
        },
        init() {
            return this;
        }
    };
}
