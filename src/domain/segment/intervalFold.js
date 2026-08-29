/**
 * Folds successive equal samples into open state intervals.
 *
 * @param {object} port - open, begin, extend, finish
 * @returns {object} collector with accept(sample)
 *
 * @example
 *   const fold = intervalFold(port);
 *   await fold.accept({ machine: 'cm8', kind: 'ladle_moving', value: 1, ts: Date.now() });
 */
export default function intervalFold(port) {
    return {
        async accept(sample) {
            const name = String(sample.value);
            const open = await port.open(sample.machine, sample.kind);
            if (!open) {
                await port.begin({ machine: sample.machine, kind: sample.kind, name, ts: sample.ts });
                return;
            }
            if (open.name === name) {
                await port.extend(open, sample.ts);
                return;
            }
            await port.finish(open, sample.ts);
            await port.begin({ machine: sample.machine, kind: sample.kind, name, ts: sample.ts });
        }
    };
}
