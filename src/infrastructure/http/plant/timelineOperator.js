import operatorById from '../../operators/operatorById.js';
import { errorResponse } from '@yarkivaev/simple-server';

function routeError(code, message, status) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    return err;
}

/**
 * Resolves anonymous display name from an optional client marker.
 *
 * @param {object} body - parsed JSON body with optional client
 * @param {object} cfg - timelineOperator options with anonymousUsers and defaultUser
 * @returns {string} display name for the decision audit row
 */
function anonymousName(body, cfg) {
    const key = body && body.client;
    const map = cfg.anonymousUsers || {};
    if (typeof key === 'string' && Object.hasOwn(map, key)) {
        return map[key];
    }
    return cfg.defaultUser || 'hmi-kiosk';
}

/**
 * Resolves operator audit context for timeline write routes.
 *
 * @param {object} options - provider, requireOperator, defaultUser, anonymousUsers
 * @returns {object} gate with resolve(body) returning audit context
 *
 * @example
 *   const gate = timelineOperator({
 *     provider, requireOperator: true, defaultUser: 'hmi-kiosk',
 *     anonymousUsers: { hmi: 'Anonymous HMI user' }
 *   });
 *   const audit = await gate.resolve({ operatorId: 2 });
 */
export default function timelineOperator(options) {
    const cfg = options || {};
    const lookup = cfg.provider ? operatorById(cfg.provider) : undefined;
    return {
        /**
         * Builds audit context from request body operatorId field.
         *
         * @param {object} body - parsed JSON body with optional operatorId
         * @returns {Promise<object>} audit with id, displayName, decidedAt
         */
        async resolve(body) {
            const { operatorId } = body;
            const decidedAt = new Date();
            if (cfg.requireOperator && (operatorId === undefined || operatorId === null)) {
                throw routeError('FORBIDDEN', 'operator required', 403);
            }
            if (operatorId !== undefined && operatorId !== null) {
                if (!lookup) {
                    throw routeError('SERVICE_UNAVAILABLE', 'operators catalog unavailable', 503);
                }
                const row = await lookup.resolve(operatorId);
                if (!row) {
                    throw routeError('BAD_REQUEST', `unknown operator id ${operatorId}`, 400);
                }
                return { id: row.id, displayName: row.displayName, decidedAt };
            }
            return {
                id: undefined,
                displayName: anonymousName(body, cfg),
                decidedAt
            };
        },
        /**
         * Sends a route error response when resolve threw a route error.
         *
         * @param {object} res - HTTP response
         * @param {Error} err - error from resolve()
         * @returns {boolean} true when a response was sent
         */
        sendError(res, err) {
            if (err.routeCode && err.routeStatus) {
                errorResponse(err.routeCode, err.message, err.routeStatus).send(res);
                return true;
            }
            return false;
        }
    };
}
