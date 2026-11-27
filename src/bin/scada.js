#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import management from '../application/management/management.js';
import readInventory from '../infrastructure/management/inventory.js';
import managementServer from '../infrastructure/management/server.js';
import { request, send } from '../infrastructure/management/protocol.js';

const usage = `Usage:
  scada contexts
  scada status [--context NAME]
  scada get components [--context NAME]
  scada logs COMPONENT --context NAME [--tail LINES]
  scada plan --context NAME
  scada apply --context NAME

Client options: --server URL (or SCADA_SERVER), --output text|json
Client credential: SCADA_TOKEN

  scada serve --config PATH [--host HOST] [--port PORT] [--cert PATH --key PATH]

Server credentials: SCADA_TOKEN (read/write), SCADA_READ_TOKEN (read only)
`;

const clientOptions = {
    server: { type: 'string' },
    context: { type: 'string' },
    output: { type: 'string', default: 'text' },
    tail: { type: 'string' }
};
const serverOptions = {
    config: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '8080' },
    cert: { type: 'string' },
    key: { type: 'string' }
};

function commandOf([verb, arg, ...rest], { context, tail }) {
    if (rest.length || (verb === 'get' && arg !== 'components') ||
        (arg !== undefined && !['logs', 'get'].includes(verb)) || (tail !== undefined && verb !== 'logs') ||
        (verb === 'contexts' && context !== undefined)) {
        throw new Error('invalid command arguments; see scada --help');
    }
    const action = ['get', 'status'].includes(verb) ? 'components' : verb;
    const result = request.safeParse({
        action,
        ...(context !== undefined && { context }),
        ...(verb === 'logs' && { component: arg, tail: tail === undefined ? undefined : Number(tail) })
    });
    if (!result.success) {
        throw new Error('invalid command arguments; see scada --help');
    }
    return result.data;
}

function textOf({ contexts, changes, logs }) {
    if (contexts) {
        return contexts.flatMap(({ name, runtime, components, error }) => {
            if (components?.length) {
                return components.map(({ id, state }) => { return `${name}\t${id}\t${state}`; });
            }
            return [`${name}\t${runtime ?? error ?? 'no components'}`];
        }).join('\n');
    }
    if (changes) {
        return changes.length ? changes.map(({ id, action }) => { return `${id}\t${action}`; }).join('\n') : 'no changes';
    }
    return logs;
}

function unhealthy({ error, components }) {
    return Boolean(error) || !components.length || components.some(({ state }) => { return state !== 'ready'; });
}

async function client(args) {
    const { positionals, values } = parseArgs({ args, allowPositionals: true, options: clientOptions });
    const command = commandOf(positionals, values);
    const url = values.server ?? process.env.SCADA_SERVER;
    const { SCADA_TOKEN: token } = process.env;
    if (!url || !token || !['text', 'json'].includes(values.output)) {
        throw new Error('set --server (or SCADA_SERVER), SCADA_TOKEN and use text or json output');
    }
    const result = await send(url, token, command);
    const text = values.output === 'json' ? JSON.stringify(result) : textOf(result);
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    if (positionals[0] === 'status' && result.contexts.some(unhealthy)) {
        process.exitCode = 1;
    }
}

async function serve(args) {
    const { values: { config, host, port, cert, key } } = parseArgs({ args, options: serverOptions });
    if (!config || Boolean(cert) !== Boolean(key) || !/^\d{1,5}$/u.test(port) || Number(port) > 65535) {
        throw new Error('serve requires --config and accepts --port 0-65535 and a --cert/--key pair');
    }
    const targets = await readInventory(config, process.env);
    const tls = cert ? { cert: await readFile(cert), key: await readFile(key) } : undefined;
    const { address, server } = await managementServer(management(targets), {
        host, port: Number(port), tls, token: process.env.SCADA_TOKEN, readToken: process.env.SCADA_READ_TOKEN
    });
    function close() {
        server.close();
    }
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    process.stdout.write(`${address}\n`);
}

const args = process.argv.slice(2);
try {
    if (args.length === 0 || args.includes('--help') || args[0] === 'help') {
        process.stdout.write(usage);
    } else if (args[0] === 'serve') {
        await serve(args.slice(1));
    } else {
        await client(args);
    }
} catch (error) {
    process.stderr.write(`scada: ${error.message}\n`);
    process.exitCode = 1;
}
