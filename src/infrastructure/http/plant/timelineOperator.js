import operatorById from '../../operators/operatorById.js';
import { errorResponse } from '@yarkivaev/simple-server';

function routeError(code, message, status) {
    const err = new Error(message);
    err.routeCode = code;
    err.routeStatus = status;
    return err;
}

/**
 * Resolves operator audit context for timeline write routes.
 *
 * @param {object} options - provider, requireOperator, defaultUser
 * @returns {object} gate with resolve(body) returning audit context
 *
 * @example
 *   const gate = timelineOperator({ provider, requireOperator: true, defaultUser: 'hmi-kiosk' });
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
                displayName: cfg.defaultUser || 'hmi-kiosk',
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
