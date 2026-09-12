import { errorResponse, jsonResponse, readBody, route } from '@yarkivaev/simple-server';

/**
 * POST /sync — pull selected kinds from an allowlisted remote plantApi.
 *
 * @param {string} basePath - API prefix
 * @param {object} sync - siteSync port with run(request)
 * @param {string} [token] - optional Bearer token
 * @returns {object[]} routes
 *
 * @example
 *   syncRoute('/api/v1', sync, process.env.SYNC_TOKEN);
 */
function rejectAuth(token, req, res) {
    if (!token) {
        return false;
    }
    if (req.headers.authorization === `Bearer ${token}`) {
        return false;
    }
    errorResponse('UNAUTHORIZED', 'site sync token is required', 401).send(res);
    return true;
}

function rejectScope(parsed, res) {
    if (parsed.site && parsed.from && parsed.to) {
        return false;
    }
    errorResponse('BAD_REQUEST', 'site sync requires site from and to', 400).send(res);
    return true;
}

export default function syncRoute(basePath, sync, token) {
    return [
        route('POST', `${basePath}/sync`, async (req, res) => {
            if (rejectAuth(token, req, res)) {
                return;
            }
            const parsed = JSON.parse(await readBody(req));
            if (rejectScope(parsed, res)) {
                return;
            }
            try {
                jsonResponse(await sync.run(parsed)).send(res);
            } catch (error) {
                errorResponse('BAD_REQUEST', error.message, 400).send(res);
            }
        })
    ];
}
