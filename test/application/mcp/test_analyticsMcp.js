import assert from 'node:assert';
import { z } from 'zod';
import analyticsMcp from '../../../src/application/mcp/analyticsMcp.js';
import shopWithTimeline from '../../../src/application/shopWithTimeline.js';
import namespaceTree from '../../../src/domain/namespace/namespaceTree.js';

function ports(extra) {
    return {
        alerts() {
            return [];
        },
        cursor() {
            return '2024-11-02T03:04:05.137Z';
        },
        measurements() {
            return [];
        },
        operations() {
            return [];
        },
        queryClickhouse() {
            return [{ value: 1 }];
        },
        samples() {
            return [];
        },
        segments() {
            return [];
        },
        state() {
            return { found: false };
        },
        ...(extra || {})
    };
}

function tree() {
    return namespaceTree([
        {
            kind: 'site',
            path: 'площадка',
            silenceSeconds: 60,
            title: 'Площадка'
        },
        {
            kind: 'metric',
            path: 'площадка/мощность',
            silenceSeconds: 60,
            source: 'gw/α/topic',
            title: 'Мощность',
            unit: 'кВт'
        }
    ]);
}

async function started(extra) {
    const lines = [];
    const token = `tok-${Math.random().toString(16).slice(2)}`;
    const bundle = extra || {};
    const mcp = analyticsMcp({
        extend: bundle.extend,
        journal(line) {
            lines.push(line);
        },
        ports: ports(bundle.ports),
        tokens: { [token]: 'аналитик' },
        tree: bundle.tree || tree()
    });
    const address = await mcp.listen(0, '127.0.0.1');
    return { address, lines, mcp, token };
}

function headers(token) {
    const base = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json'
    };
    if (typeof token === 'string') {
        base.authorization = `Bearer ${token}`;
    }
    return base;
}

async function post(port, token, message) {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        body: JSON.stringify(message),
        headers: headers(token),
        method: 'POST'
    });
    const body = await response.json();
    return { body, status: response.status };
}

function call(name, args) {
    return {
        id: 7,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name }
    };
}

describe('analyticsMcp', function() {
    it('rejects a missing bearer token', async function() {
        const { address, mcp } = await started();
        const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
            body: JSON.stringify(call('state', { path: 'площадка' })),
            headers: headers(),
            method: 'POST'
        });
        const status = response.status;
        await response.arrayBuffer();
        await mcp.close();
        assert.strictEqual(status, 401, 'missing bearer was allowed onto the MCP endpoint');
    });

    it('returns a tool error for clickhouse SQL without ts', async function() {
        const { address, mcp, token } = await started();
        const { body } = await post(address.port, token, call('query_clickhouse', {
            sql: "SELECT value FROM metrics WHERE topic = 'α-ряд'"
        }));
        await mcp.close();
        assert.strictEqual(body.result.isError, true, 'clickhouse query without ts ran as a successful tool');
    });

    it('writes one journal line for a tool call', async function() {
        const { address, lines, mcp, token } = await started();
        await post(address.port, token, call('query_clickhouse', {
            sql: "SELECT value FROM metrics WHERE topic = 'α-ряд'"
        }));
        await mcp.close();
        assert.strictEqual(JSON.parse(lines[0]).shape, 'SELECT value FROM metrics WHERE topic = ?', 'journal missed the tool call');
    });

    it('keeps gateway topics out of plant topology', async function() {
        const { address, mcp, token } = await started();
        const { body } = await post(address.port, token, {
            id: 3,
            jsonrpc: '2.0',
            method: 'resources/read',
            params: { uri: 'plant://topology' }
        });
        await mcp.close();
        assert.strictEqual(body.result.contents[0].text.includes('gw/α/topic'), false, 'topology resource leaked a gateway topic');
    });

    it('omits query_postgres when no standby port is supplied', async function() {
        const { address, mcp, token } = await started();
        const { body } = await post(address.port, token, {
            id: 4,
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {}
        });
        await mcp.close();
        const names = body.result.tools.map(function(tool) {
            return tool.name;
        });
        assert.strictEqual(names.includes('query_postgres'), false, 'query_postgres was registered without a standby port');
    });

    it('registers query_postgres when a standby port is supplied', async function() {
        const { address, mcp, token } = await started({
            ports: {
                queryPostgres() {
                    return [];
                }
            }
        });
        const { body } = await post(address.port, token, {
            id: 5,
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {}
        });
        await mcp.close();
        const names = body.result.tools.map(function(tool) {
            return tool.name;
        });
        assert.strictEqual(names.includes('query_postgres'), true, 'query_postgres was missing despite a standby port');
    });

    it('counts a tool call by tool name', async function() {
        const { address, mcp, token } = await started();
        await post(address.port, token, call('query_clickhouse', {
            sql: "SELECT value FROM metrics WHERE topic = 'α-ряд'"
        }));
        const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
        const text = await response.text();
        await mcp.close();
        assert.strictEqual(text.includes('tool="query_clickhouse"'), true, 'metrics missed the tool counter');
    });

    it('omits the caller name from prometheus labels', async function() {
        const { address, mcp, token } = await started();
        await post(address.port, token, call('query_clickhouse', {
            sql: "SELECT value FROM metrics WHERE topic = 'α-ряд'"
        }));
        const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
        const text = await response.text();
        await mcp.close();
        assert.strictEqual(text.includes('аналитик'), false, 'metrics labeled a caller');
    });

    it('exposes an in-flight gauge for each engine', async function() {
        const { address, mcp, token } = await started();
        await post(address.port, token, call('state', { path: 'площадка' }));
        const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
        const text = await response.text();
        await mcp.close();
        assert.strictEqual(text.includes('mcp_inflight{engine="plant"}'), true, 'metrics missed the plant in-flight gauge');
    });

    it('leaves SQL text out of prometheus labels', async function() {
        const { address, mcp, token } = await started();
        await post(address.port, token, call('query_clickhouse', {
            sql: "SELECT value FROM metrics WHERE topic = 'α-ряд'"
        }));
        const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
        const text = await response.text();
        await mcp.close();
        assert.strictEqual(text.includes('α-ряд'), false, 'metrics included SQL text');
    });

    it('calls a tool registered by extend', async function() {
        const { address, mcp, token } = await started({
            extend(server) {
                server.registerTool('echo_path', {
                    description: 'Echo a namespace path',
                    inputSchema: { path: z.string() }
                }, function echo(args) {
                    return { content: [{ text: args.path, type: 'text' }] };
                });
            }
        });
        const { body } = await post(address.port, token, call('echo_path', { path: 'цех-α' }));
        await mcp.close();
        assert.strictEqual(body.result.content[0].text, 'цех-α', 'extend did not register a callable tool');
    });

    it('returns persisted segments when the plant timeline is postgres', async function() {
        const start = new Date('2024-11-02T03:04:05.137Z');
        const tag = `шлак-α-${Math.floor(Math.random() * 90)}`;
        const pool = {
            async query() {
                return {
                    rows: [{
                        name: 'off',
                        start_time: start,
                        end_time: new Date(start.getTime() + 180000),
                        duration: 180,
                        options: '[]',
                        tags: JSON.stringify([tag]),
                        properties: '{}'
                    }]
                };
            }
        };
        const tl = shopWithTimeline(`ихт-${Math.floor(Math.random() * 9000 + 1000)}`, { pool });
        const { address, mcp, token } = await started({
            ports: {
                segments() {
                    return tl.list({
                        from: start,
                        to: new Date(start.getTime() + 3600000)
                    });
                }
            }
        });
        const { body } = await post(address.port, token, call('segments', {
            from: start.toISOString(),
            path: 'площадка',
            to: new Date(start.getTime() + 3600000).toISOString()
        }));
        await mcp.close();
        const payload = JSON.parse(body.result.content[0].text);
        assert.strictEqual(
            payload.rows[0].tags,
            JSON.stringify([tag]),
            'segments tool missed persisted postgres rows'
        );
    });
});
