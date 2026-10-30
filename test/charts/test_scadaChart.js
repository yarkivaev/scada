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

describe('scada chart', function() {
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
});
