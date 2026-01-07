/**
 * Tracks load/dispense events during a melting session.
 * Maintains running totals for loaded and dispensed metal.
 *
 * @param {number} initial - initial weight in machine when melting started
 * @returns {object} chronology with load, dispense, get methods
 *
 * @example
 *   const history = chronology(100);
 *   history.load(500);
 *   history.dispense(480);
 *   history.get(); // { initial: 100, loaded: 500, dispensed: 480, weight: 120 }
 */
export default function chronology(initial) {
    let totalLoaded = 0;
    let totalDispensed = 0;
    return {
        load(amount) {
            totalLoaded += amount;
        },
        dispense(amount) {
            totalDispensed += amount;
        },
        get() {
            return {
                initial,
                loaded: totalLoaded,
                dispensed: totalDispensed,
                weight: initial + totalLoaded - totalDispensed
            };
        }
    };
}
