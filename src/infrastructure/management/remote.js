/** Expose a concrete context on another management endpoint as a local runtime. */
import { send } from './protocol.js';

export default function remote({ server, token, context }) {
    function request(action, options = {}) {
        return send(server, token, { action, context, forwarded: true, ...options });
    }

    async function components() {
        const { contexts } = await request('components');
        const target = contexts.find(({ name }) => { return name === context; });
        if (!target) {
            throw new Error('remote server did not return the requested context');
        }
        if (target.error) {
            throw new Error(target.error);
        }
        return target.components;
    }

    async function logs(component, tail) {
        const result = await request('logs', { component, tail });
        return result.logs;
    }

    return {
        components, logs,
        plan() { return request('plan'); },
        apply() { return request('apply'); }
    };
}
