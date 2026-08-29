import machineRoute from '../infrastructure/http/plant/routes/machineRoute.js';
import measurementRoute from '../infrastructure/http/plant/routes/measurementRoute.js';
import stateRoute from '../infrastructure/http/plant/routes/stateRoute.js';
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

function pass(_id, rows) {
    return rows;
}

/**
 * Composable plant HTTP API factory.
 *
 * @param {string} basePath - base URL path
 * @param {object} plant - plant domain object with operations (optional kindSources at construction)
 * @param {object} [config] - clock, extraRoutes, requestTimeoutMs, heartbeat, decorateTimeline
 * @returns {object} routes with list() and handle()
 *
 * @example
 *   const api = plantApi('/api/v1', plant, { extraRoutes: siteRoute('/api/v1', plant) });
 */
export default function plantApi(basePath, plant, config) {
    const opts = config || {};
    plant.init();
    const time = opts.clock || (() => {
        return new Date();
    });
    const extra = opts.extraRoutes || [];
    const decorate = opts.decorateTimeline || pass;
    const routeList = [
        ...catalogRoute(basePath, opts.tagCatalog),
        ...machineRoute(basePath, plant),
        ...stateRoute(basePath, plant),
        ...measurementStream(basePath, plant, time),
        ...measurementRoute(basePath, plant, time),
        ...alertStream(basePath, plant, time),
        ...alertRoute(basePath, plant),
        ...timelineRoute(basePath, plant, opts.timelineOperator, decorate),
        ...timelineStream(basePath, plant, time, decorate),
        ...operationRoute(basePath, plant, opts.timelineOperator, opts.operationDecisions, opts.owners),
        ...operationStream(basePath, plant, time),
        ...heartbeatStream(basePath, time, opts.heartbeat),
        ...(time.jump ? simulationRoute(basePath, time) : []),
        ...extra
    ];
    return routes(routeList, { requestTimeoutMs: opts.requestTimeoutMs });
}
