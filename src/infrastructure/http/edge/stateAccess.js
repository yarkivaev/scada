import { errorResponse } from '@yarkivaev/simple-server';

export function hasAccess(request, token) {
    if (!token) {
        return true;
    }
    const header = request.headers.authorization || '';
    return header === `Bearer ${token}`;
}

export function sendForbidden(res) {
    errorResponse('FORBIDDEN', 'forbidden', 403).send(res);
}
