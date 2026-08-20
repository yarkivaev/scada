import plant from '../domain/plant/plant.js';
import initialized from '../domain/shared/initialized.js';
import postgresPool from '../infrastructure/persistence/postgresPool.js';

/**
 * Generic plant factory wiring sensors and a shop factory over a connection.
 *
 * @param {Array<{device: string, machine: string}>} machines - machine descriptors
 * @param {object} options - connection, buildSensors, shopFactory, pool, alerts, userDecisions, shopName
 * @returns {Promise<object>} plant with shops and init
 *
 * @example
 *   const p = await metricsPlant(machines, {
 *     connection: () => clickhouseConnection(host, opts),
 *     buildSensors: (conn, entry) => ({ voltage: sensor(conn, entry) }),
 *     shopFactory: genericShop
 *   });
 */
export default async function metricsPlant(machines, options) {
    const connection = await options.connection();
    const pool = postgresPool(options);
    const entries = machines.map((entry) => {
        return {
            name: entry.machine,
            sensors: options.buildSensors(connection, entry)
        };
    });
    const shop = options.shopFactory(entries, {
        pool,
        alerts: options.alerts,
        userDecisions: options.userDecisions,
        segments: options.segments,
        shopName: options.shopName
    });
    return plant(initialized({ [shop.name()]: shop }, Object.values));
}
