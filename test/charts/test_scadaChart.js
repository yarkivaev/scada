import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Renders the scada chart with an extra values file.
 *
 * @param {string} body - YAML values
 * @returns {string} rendered manifests
 */
function render(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scada-chart-'));
    const file = path.join(dir, 'values.yaml');
    fs.writeFileSync(file, body);
    return execFileSync('helm', [
        'template', 'plant', path.join(root, 'charts/scada'),
        '--namespace', 'scada',
        '-f', file
    ], { encoding: 'utf8' });
}

/**
 * Reads one container env value from a rendered manifest.
 *
 * @param {string} rendered - helm template output
 * @param {string} name - env name
 * @returns {string|object|Array} decoded value, or empty when the name is absent
 */
function envOf(rendered, name) {
    const lines = rendered.split('\n');
    const index = lines.findIndex((line) => {
        return line.trim() === `- name: ${name}`;
    });
    if (index < 0) {
        return '';
    }
    const raw = lines[index + 1].trim().replace(/^value:\s*/u, '');
    if (!raw.startsWith('"')) {
        return raw;
    }
    const decoded = JSON.parse(raw);
    if (typeof decoded === 'string' && (decoded.startsWith('[') || decoded.startsWith('{'))) {
        return JSON.parse(decoded);
    }
    return decoded;
}

describe('scada chart', function() {
    this.timeout(30000);

    it('publishes edge machine owners as EDGE_MACHINES', function() {
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const device = `d${Math.random().toString(36).slice(2, 8)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'machines:',
            `  - id: ${machine}`,
            `    device: ${device}`,
            '    shop: hall',
            '    kind: unit'
        ].join('\n'));
        assert.ok(
            rendered.includes(machine) && rendered.includes(device),
            'the chart dropped the edge machine list'
        );
    });

    it('publishes central owner routes as EDGE_SITES', function() {
        const base = `http://192.0.2.${Math.floor(Math.random() * 200)}:${30000 + Math.floor(Math.random() * 1000)}/api/v1`;
        const machine = `m${Math.random().toString(36).slice(2, 8)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'role: central',
            'sites:',
            `  - baseUrl: ${base}`,
            '    machines:',
            `      - ${machine}`
        ].join('\n'));
        assert.ok(
            rendered.includes(base) && rendered.includes(machine),
            'the chart dropped the central owner routes'
        );
    });

    it('omits ClickHouse when the site stores metrics in Postgres', function() {
        const rendered = render('image: example.invalid/scada:1\nclickhouse:\n  enabled: false\n');
        assert.strictEqual(
            rendered.includes('clickhouse/clickhouse-server'),
            false,
            'an edge site still rendered ClickHouse'
        );
    });

    it('renders ClickHouse when the site role asks for it', function() {
        const rendered = render('image: example.invalid/scada:1\nrole: central\nclickhouse:\n  enabled: true\n');
        assert.ok(
            rendered.includes('clickhouse/clickhouse-server:24.8'),
            'a central site did not render ClickHouse'
        );
    });

    it('binds Postgres credentials from the named secret', function() {
        const secret = `pg-${Math.random().toString(36).slice(2, 8)}`;
        const rendered = render(`image: example.invalid/scada:1\npostgres:\n  enabled: true\n  secret: ${secret}\n`);
        assert.ok(
            rendered.includes(`name: ${secret}`),
            'the chart did not reference the Postgres secret'
        );
    });

    it('declares the durable segment ingest queue', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.ok(
            rendered.includes('scada.segments.ingest'),
            'the broker definitions omitted the segment ingest queue'
        );
    });

    it('keeps every machine when an edge owns more than one', function() {
        const first = `m${Math.random().toString(36).slice(2, 8)}`;
        const second = `n${Math.random().toString(36).slice(2, 8)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'role: edge',
            'machines:',
            `  - id: ${first}`,
            '    device: hall-a',
            '    shop: melt',
            '    kind: furnace',
            `  - id: ${second}`,
            '    device: hall-b',
            '    shop: cast',
            '    kind: caster'
        ].join('\n'));
        assert.deepStrictEqual(
            envOf(rendered, 'EDGE_MACHINES').map((item) => {
                return item.id;
            }),
            [first, second],
            'a multi-machine edge dropped one of its machines'
        );
    });

    it('keeps every owner route when central fronts several edges', function() {
        const first = `http://192.0.2.${Math.floor(Math.random() * 50)}:30300/api/v1`;
        const second = `http://192.0.2.${50 + Math.floor(Math.random() * 50)}:30300/api/v1`;
        const left = `a${Math.random().toString(36).slice(2, 6)}`;
        const right = `b${Math.random().toString(36).slice(2, 6)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'role: central',
            'clickhouse:',
            '  enabled: true',
            'sites:',
            `  - baseUrl: ${first}`,
            '    machines:',
            `      - ${left}`,
            `  - baseUrl: ${second}`,
            '    machines:',
            `      - ${right}`
        ].join('\n'));
        assert.deepStrictEqual(
            envOf(rendered, 'EDGE_SITES'),
            [
                { baseUrl: first, machines: [left] },
                { baseUrl: second, machines: [right] }
            ],
            'a multi-edge central dropped an owner route'
        );
    });

    it('leaves a standalone site without owner routes', function() {
        const rendered = render('image: example.invalid/scada:1\nrole: edge\nmachines: []\nsites: []\n');
        assert.strictEqual(
            envOf(rendered, 'EDGE_SITES') === '' && envOf(rendered, 'EDGE_MACHINES') === '',
            true,
            'a standalone site still published federation routes'
        );
    });

    it('sets the sink profile to central when that is the site role', function() {
        const rendered = render('image: example.invalid/scada:1\nrole: central\n');
        assert.strictEqual(
            envOf(rendered, 'SINK_DB_PROFILE'),
            'central',
            'a central site did not select the central sink profile'
        );
    });

    it('sets the sink profile to edge when that is the site role', function() {
        const rendered = render('image: example.invalid/scada:1\nrole: edge\n');
        assert.strictEqual(
            envOf(rendered, 'SINK_DB_PROFILE'),
            'edge',
            'an edge site did not select the edge sink profile'
        );
    });

    it('exposes the plant LAN port the site configuration names', function() {
        const port = 30000 + Math.floor(Math.random() * 2000);
        const rendered = render(`image: example.invalid/scada:1\nservice:\n  nodePort: ${port}\n`);
        assert.ok(
            rendered.includes(`nodePort: ${port}`),
            'the chart did not expose the configured plant LAN port'
        );
    });

    it('omits the broker when the site does not run RabbitMQ', function() {
        const rendered = render('image: example.invalid/scada:1\nrabbitmq:\n  enabled: false\n');
        assert.strictEqual(
            rendered.includes('scada.segments.ingest'),
            false,
            'a site without RabbitMQ still rendered the ingest broker'
        );
    });

    it('omits Postgres when the site uses an external database', function() {
        const rendered = render('image: example.invalid/scada:1\npostgres:\n  enabled: false\n');
        assert.strictEqual(
            rendered.includes('postgres:16'),
            false,
            'an external database site still rendered Postgres'
        );
    });

    it('runs the command the site configuration names', function() {
        const bin = `bin/site-${Math.random().toString(36).slice(2, 6)}.js`;
        const rendered = render(`image: example.invalid/scada:1\ncommand:\n  - node\n  - ${bin}\n`);
        assert.ok(
            rendered.includes(bin),
            'the chart ignored the configured process command'
        );
    });
});
