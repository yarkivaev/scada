/** Read and start explicitly managed systemd services on this host. */
import command from './command.js';

function unitState(text) {
    const active = /^ActiveState=(?<state>[^\n]+)$/mu.exec(text)?.groups.state;
    const load = /^LoadState=(?<state>[^\n]+)$/mu.exec(text)?.groups.state;
    if (load !== 'loaded') {
        return 'failed';
    }
    const states = new Map([['active', 'ready'], ['inactive', 'stopped'], ['failed', 'failed']]);
    return states.get(active) ?? 'pending';
}

export default function systemd({ units }) {
    function components() {
        return Promise.all(Object.keys(units).map(async (id) => {
            const text = await command('systemctl', ['show', '--property=LoadState,ActiveState', '--', id]);
            return { id, state: unitState(text) };
        }));
    }

    function logs(id, tail) {
        if (!Object.hasOwn(units, id)) {
            throw new Error('unknown component');
        }
        return command('journalctl', ['--no-pager', '--unit', id, '--lines', String(tail)]);
    }

    async function plan() {
        const changes = (await components()).flatMap(({ id, state }) => {
            if (units[id] === 'running' && state !== 'ready') {
                return [{ id, action: 'start' }];
            }
            return [];
        });
        return { changes };
    }

    async function apply() {
        const result = await plan();
        const ids = result.changes.map(({ id }) => { return id; });
        if (ids.length > 0) {
            await command('systemctl', ['start', '--', ...ids], 300000);
        }
        return result;
    }

    return { components, logs, plan, apply };
}
