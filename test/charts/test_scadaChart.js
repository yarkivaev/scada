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

/**
 * Reads the broker definitions embedded in a rendered manifest.
 *
 * @param {string} rendered - helm template output
 * @returns {object} RabbitMQ definitions
 */
function broker(rendered) {
    const marker = 'definitions.json: |';
    const start = rendered.indexOf(marker);
    const next = rendered.indexOf('\n---', start);
    const body = rendered.slice(start + marker.length, next).split('\n').map((line) => {
        return line.replace(/^ {4}/u, '');
    }).join('\n').trim();
    return JSON.parse(body);
}

/**
 * Routing keys bound to one queue.
 *
 * @param {string} rendered - helm template output
 * @param {string} queue - destination queue
 * @returns {string[]} routing keys
 */
function routingKeys(rendered, queue) {
    return broker(rendered).bindings.filter((item) => {
        return item.destination === queue;
    }).map((item) => {
        return item.routing_key;
    });
}

/**
 * Collector Deployment names in a rendered manifest.
 *
 * @param {string} rendered - helm template output
 * @returns {string[]} deployment names
 */
function collectorNames(rendered) {
    return rendered.split('\n').filter((line) => {
        return line.trim().startsWith('name:') && line.includes('-collector-');
    }).map((line) => {
        return line.trim().replace(/^name:\s*/u, '');
    });
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

    it('keeps extra labels on the postgres selector', function() {
        const mark = `st${Math.random().toString(36).slice(2, 6)}`;
        const rendered = render(`image: example.invalid/scada:1\nextraLabels:\n  stage: ${mark}\n`);
        const block = rendered.split('kind: StatefulSet')[1];
        const sel = block.slice(block.indexOf('matchLabels:'), block.indexOf('template:'));
        assert.strictEqual(
            sel.includes(`stage: "${mark}"`) && sel.includes('app.kubernetes.io/instance') === false,
            true,
            'the postgres selector dropped the extra label or kept the instance key'
        );
    });

    it('keeps postgres data under the named directory', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.strictEqual(
            rendered.includes('name: PGDATA') && rendered.includes('/var/lib/postgresql/data/pgdata'),
            true,
            'the postgres container lost PGDATA'
        );
    });

    it('uses the named postgres claim', function() {
        const size = `${1 + Math.floor(Math.random() * 8)}Gi`;
        const rendered = render(`image: example.invalid/scada:1\npostgres:\n  storage: ${size}\n  storageClass: topolvm\n`);
        assert.strictEqual(
            rendered.includes(`storage: "${size}"`) && rendered.includes('storageClassName: "topolvm"'),
            true,
            'the chart ignored the postgres claim'
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

    it('mounts broker configuration as files without shadowing its directory', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.ok(
            ['enabled_plugins', 'rabbitmq.conf', 'definitions.json'].every((name) => {
                return rendered.includes(`mountPath: /etc/rabbitmq/${name}\n`)
                    && rendered.includes(`subPath: ${name}\n`);
            }) && !rendered.includes('mountPath: /etc/rabbitmq\n'),
            'mixed directory and file mounts prevent RabbitMQ from starting'
        );
    });

    it('enables mqtt beside stomp', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.ok(
            rendered.includes('[rabbitmq_stomp, rabbitmq_mqtt, rabbitmq_management].')
                && rendered.includes('containerPort: 1883'),
            'the broker did not publish mqtt beside stomp'
        );
    });

    it('binds a namespace path instead of a device family', function() {
        const head = `bay${Math.random().toString(36).slice(2, 6)}`;
        const leaf = `volt${Math.random().toString(36).slice(2, 6)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'collectors:',
            '  - command:',
            '      - node',
            '      - bin/read.js',
            '    address: modbus://192.0.2.40:502',
            `    path: ${head}/${leaf}`
        ].join('\n'));
        assert.deepStrictEqual(
            routingKeys(rendered, 'scada.telemetry.ingest').sort(),
            [`${head}.${leaf}`],
            'the broker did not bind the namespace path'
        );
    });

    it('binds a trailing star as everything below that path', function() {
        const head = `zone${Math.random().toString(36).slice(2, 6)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'buses:',
            '  - url: amqp://192.0.2.41:5672',
            '    names:',
            `      - ${head}/*`
        ].join('\n'));
        assert.deepStrictEqual(
            routingKeys(rendered, 'scada.telemetry.outbox'),
            [`${head}.#`],
            'a trailing star did not bind everything below the path'
        );
    });

    it('keeps a blanket telemetry binding when no path is named', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.deepStrictEqual(
            routingKeys(rendered, 'scada.telemetry.ingest'),
            ['#'],
            'a site without paths lost the telemetry ingest binding'
        );
    });

    it('does not install a remote shovel', function() {
        const rendered = render([
            'image: example.invalid/scada:1',
            'bus:',
            '  - url: amqp://192.0.2.42:5672',
            '    names:',
            '      - bay/out'
        ].join('\n'));
        assert.strictEqual(
            rendered.includes('shovel') || rendered.includes('MX210'),
            false,
            'the chart installed a shovel or a device-family binding'
        );
    });

    it('preserves secret references in both site and sink environments',function(){
        const rendered=render('image: example.invalid/site:1\nenv:\n  - name: STATE_HTTP_TOKEN\n    valueFrom:\n      secretKeyRef:\n        name: history-token\n        key: token\n');
        const deployments=rendered.split('---').filter(row=>{return row.includes('kind: Deployment') && (row.includes('name: plant-site-server') || row.includes('name: plant-supervisor-sink'));});
        assert.equal(deployments.length,2);
        for(const row of deployments){assert.match(row,/name: STATE_HTTP_TOKEN\s+valueFrom:\s+secretKeyRef:/u);assert.match(row,/name: history-token/u);}
    });

    it('runs site and sink from the same image' , function() {
        const image = `example.invalid/site:${Math.random().toString(36).slice(2, 8)}`;
        const rendered = render(`image: ${image}\n`);
        assert.strictEqual(
            rendered.includes('app: site-server')
                && rendered.includes('app: supervisor-sink')
                && rendered.split(`image: "${image}"`).length - 1,
            2,
            'site and sink did not share one image'
        );
    });

    it('leaves stomp consumers on the sink', function() {
        const rendered = render('image: example.invalid/scada:1\n');
        assert.strictEqual(
            envOf(rendered, 'SINK_PIPELINES'),
            'false',
            'the site still consumed the broker pipelines'
        );
    });

    it('does not render profile apps', function() {
        const rendered = render([
            'image: example.invalid/scada:1',
            'apps:',
            '  - { name: frontend, image: example.invalid/hmi:1 }',
            '  - { name: wms, image: example.invalid/wms:1 }',
            '  - { name: supervisor, image: example.invalid/classifier:1 }'
        ].join('\n'));
        assert.strictEqual(
            rendered.includes('example.invalid/hmi:1')
                || rendered.includes('example.invalid/wms:1')
                || rendered.includes('example.invalid/classifier:1'),
            false,
            'the chart rendered a profile app'
        );
    });

    it('shares one collector across fan-in on the same serial device', function() {
        const device = `/dev/ttyUSB${Math.floor(Math.random() * 8)}`;
        const left = `bay/${Math.random().toString(36).slice(2, 6)}`;
        const right = `bay/${Math.random().toString(36).slice(2, 6)}`;
        const point = `holding:${Math.floor(Math.random() * 4000)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'collectors:',
            '  - command:',
            '      - node',
            '      - bin/read.js',
            `    address: "modbus://${device}?unit=1"`,
            `    path: ${left}`,
            '    mapping:',
            `      voltage: "${point}"`,
            '  - command:',
            '      - node',
            '      - bin/read.js',
            `    address: "modbus://${device}?unit=2"`,
            `    path: ${right}`
        ].join('\n'));
        assert.strictEqual(
            collectorNames(rendered).length === 1
                && rendered.includes(left)
                && rendered.includes(right)
                && rendered.includes(point)
                && rendered.includes(device)
                && rendered.includes('type: CharDevice'),
            true,
            'fan-in on one serial device did not share a collector'
        );
    });

    it('shares one collector across fan-in that use the same command', function() {
        const left = `modbus://192.0.2.${10 + Math.floor(Math.random() * 20)}:502`;
        const right = `modbus://192.0.2.${40 + Math.floor(Math.random() * 20)}:502`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'collectors:',
            '  - command: ["node", "bin/read.js"]',
            `    address: "${left}"`,
            '    path: bay/left',
            '  - command: ["node", "bin/read.js"]',
            `    address: "${right}"`,
            '    path: bay/right'
        ].join('\n'));
        assert.strictEqual(
            collectorNames(rendered).length === 1
                && JSON.stringify(envOf(rendered, 'ADDRESS')) === JSON.stringify([left, right]),
            true,
            'fan-in with one command did not share a collector'
        );
    });

    it('keeps collectors apart when the commands differ', function() {
        const left = `/dev/ttyS${Math.floor(Math.random() * 4)}`;
        const right = `/dev/ttyS${4 + Math.floor(Math.random() * 4)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'collectors:',
            '  - command: ["node", "bin/one.js"]',
            `    address: "${left}"`,
            '    path: bay/left',
            '  - command: ["node", "bin/two.js"]',
            `    address: "${right}"`,
            '    path: bay/right'
        ].join('\n'));
        assert.strictEqual(
            collectorNames(rendered).length,
            2,
            'different commands collapsed into one collector'
        );
    });

    it('rejects two commands on one serial device', function() {
        const device = `/dev/ttyUSB${Math.floor(Math.random() * 8)}`;
        assert.throws(
            () => {
                return render([
                    'image: example.invalid/scada:1',
                    'collectors:',
                    '  - command: ["node", "bin/one.js"]',
                    `    address: "${device}?unit=1"`,
                    '    path: bay/one',
                    '  - command: ["node", "bin/two.js"]',
                    `    address: "${device}?unit=2"`,
                    '    path: bay/two'
                ].join('\n'));
            },
            'the chart accepted two commands on one serial device'
        );
    });

    it('passes document paths in STREAM and leaves the process PATH', function() {
        const stem = `bay/ünit-${Math.random().toString(36).slice(2, 6)}`;
        const rendered = render([
            'image: example.invalid/scada:1',
            'collectors:',
            '  - command:',
            '      - node',
            '      - bin/read.js',
            '    address: modbus://192.0.2.40:502',
            `    path: ${stem}`
        ].join('\n'));
        assert.deepStrictEqual(
            [envOf(rendered, 'PATH'), envOf(rendered, 'STREAM')],
            ['', [stem]],
            'the collector replaced the process PATH with document paths'
        );
    });
});


describe('ingest dead-letter configuration', function() {
    it('renders a durable quarantine queue and policy without changing existing queue arguments', function() {
        const definitions = broker(render('image: example.invalid/app:1\nrabbitmq:\n  deadLetter:\n    queue: scada.ingest.dlq\n'));
        assert.ok(definitions.queues.some((queue) => { return queue.name === 'scada.ingest.dlq' && queue.durable; }));
        const policy = definitions.policies.find((item) => { return item.name === 'ingest-dlq'; });
        assert.equal(policy.definition['dead-letter-routing-key'], 'scada.ingest.dlq');
        assert.ok(new RegExp(policy.pattern, 'u').test('scada.segments.ingest'));
        assert.ok(!new RegExp(policy.pattern, 'u').test('scada.ingest.dlq'));
    });
});
