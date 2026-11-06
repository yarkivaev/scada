/**
 * Continues a delivery chain after a rejected prior step.
 *
 * @param {Promise} pending - prior chain
 * @returns {Promise} settled chain
 */
function resume(pending) {
    return pending.then((value) => {
        return value;
    }, (error) => {
        return error;
    });
}

/**
 * Chains one arrival: read the body, then start deliver.
 * Serial waits for deliver. Otherwise persist may overlap after enqueue.
 *
 * @param {Promise} pending - prior arrival
 * @param {Function} read - returns a promise for the body
 * @param {Function} deliver - starts persist for one body
 * @param {boolean} serial - wait for persist before the next arrival
 * @returns {Promise} chain
 *
 * @example
 *   let pending = Promise.resolve();
 *   pending = follow(pending, () => Promise.resolve('a'), write, false);
 */
export default function follow(pending, read, deliver, serial, onError = (error) => { process.stderr.write(`Delivery failed: ${error.message}\n`); }) {
    return resume(pending).then(async () => {
        const body = await read();
        const run = deliver(body);
        if (serial) {
            return run;
        }
        void run.catch((error) => {
            try { onError(error); } catch {
                // Reporting cannot turn a detached delivery into an unhandled rejection.
            }
        });
        return undefined;
    });
}
