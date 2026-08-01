import machineRoute from '../infrastructure/http/plant/routes/machineRoute.js';
import measurementRoute from '../infrastructure/http/plant/routes/measurementRoute.js';
import measurementStream from '../infrastructure/http/plant/streams/measurementStream.js';
import alertRoute from '../infrastructure/http/plant/routes/alertRoute.js';
import alertStream from '../infrastructure/http/plant/streams/alertStream.js';
import timelineRoute from '../infrastructure/http/plant/routes/timelineRoute.js';
import timelineStream from '../infrastructure/http/plant/streams/timelineStream.js';
import operationRoute from '../infrastructure/http/plant/routes/operationRoute.js';
import operationStream from '../infrastructure/http/plant/streams/operationStream.js';
import heartbeatStream from '../infrastructure/http/plant/streams/heartbeatStream.js';
import simulationRoute from '../infrastructure/http/plant/routes/simulationRoute.js';
import catalogRoute from '../infrastructure/http/plant/routes/catalogRoute.js';
import { routes } from '@yarkivaev/simple-server';

/**
 * Composable plant HTTP API factory.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object with operations (optional kindSources at construction)
 * @param {object} [config] - clock, extraRoutes, requestTimeoutMs, heartbeat
 * @returns {object} routes with list() and handle()
 *
 * @example
 *   const api = plantApi('/api/v1', plant, { extraRoutes: meltingRoute('/api/v1', plant) });
 */
export default function plantApi(basePath, plant, config) {
    const opts = config || {};
    plant.init();
    const time = opts.clock || (() => {
        return new Date();
    });
    const extra = opts.extraRoutes || [];
    const routeList = [
        ...catalogRoute(basePath, opts.tagCatalog),
        ...machineRoute(basePath, plant),
        ...measurementStream(basePath, plant, time),
        ...measurementRoute(basePath, plant, time),
        ...alertStream(basePath, plant, time),
        ...alertRoute(basePath, plant),
        ...timelineRoute(basePath, plant, opts.timelineOperator),
        ...timelineStream(basePath, plant, time),
        ...operationRoute(basePath, plant),
        ...operationStream(basePath, plant, time),
        ...heartbeatStream(basePath, time, opts.heartbeat),
        ...(time.jump ? simulationRoute(basePath, time) : []),
        ...extra
    ];
    return routes(routeList, { requestTimeoutMs: opts.requestTimeoutMs });
}
