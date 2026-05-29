/**
 * Shop containing machines and shop-level alerts.
 *
 * @param {string} name - unique identifier for the shop
 * @param {object} machines - initialized wrapper of machines
 * @param {object} alertHistory - alerts collection for the shop
 * @returns {object} shop with name, machines, alerts properties and init method
 *
 * @example
 *   const area = shop('area1', initialized({ m1: machine }, Object.values), alerts());
 *   area.init();
 */
export default function shop(name, machines, alertHistory) {
    return {
        name() {
            return name;
        },
        machines,
        alerts: alertHistory,
        init() {
            machines.init();
        }
    };
}
