/* eslint-disable no-await-in-loop */
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { GenericContainer } from 'testcontainers';
import { createClient } from '@clickhouse/client';
import activityTracking from '../../../../../src/infrastructure/ingest/activity/activityTracking.js';

/**
 * Pushes a log entry to Loki via HTTP API.
 *
 * @param {string} url - Loki base URL
 * @param {object} labels - Stream labels
 * @param {string} line - Log line content
 */
async function pushToLoki(url, labels, line) {
    const ts = Date.now() * 1000000;
    const payload = {
        streams: [{
            stream: labels,
            values: [[ts.toString(), line]]
        }]
    };
    await fetch(`${url}/loki/api/v1/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

/**
 * Polls ClickHouse until expected rows appear or timeout.
 *
 * @param {object} client - ClickHouse client
 * @param {string} query - SQL query
 * @param {number} expected - Expected minimum row count
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Array>} Rows found
 */
async function poll(client, query, expected, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await client.query({ query, format: 'JSONEachRow' });
        const rows = await result.json();
        if (rows.length >= expected) {
            return rows;
        }
        await new Promise((resolve) => { setTimeout(resolve, 500)});
    }
    const result = await client.query({ query, format: 'JSONEachRow' });
    return result.json();
}

describe('activityTracking pipeline integration', function() {
    this.retries(2);
    let lokiContainer;
    let clickhouseContainer;
    let lokiUrl;
    let clickhouseUrl;
    let clickhouseClient;

    before(async function() {
        this.timeout(180000);
        const [lokiC, chC] = await Promise.all([
            new GenericContainer('grafana/loki:2.9.0')
                .withExposedPorts(3100)
                .withStartupTimeout(60000)
                .start(),
            new GenericContainer('clickhouse/clickhouse-server:24')
                .withExposedPorts(8123)
                .withStartupTimeout(60000)
                .start()
        ]);
        lokiContainer = lokiC;
        clickhouseContainer = chC;
        const lokiHost = lokiContainer.getHost();
        const lokiPort = lokiContainer.getMappedPort(3100);
        lokiUrl = `http://${lokiHost}:${lokiPort}`;
        const chHost = clickhouseContainer.getHost();
        const chPort = clickhouseContainer.getMappedPort(8123);
        clickhouseUrl = `http://${chHost}:${chPort}`;
        let retries = 30;
        while (retries > 0) {
            try {
                const response = await fetch(`${lokiUrl}/ready`);
                if (response.ok) {
                    break;
                }
            } catch {
                // Loki not ready yet
            }
            retries -= 1;
            await new Promise((resolve) => { setTimeout(resolve, 1000)});
        }
        clickhouseClient = createClient({ url: clickhouseUrl });
        retries = 30;
        while (retries > 0) {
            try {
                await clickhouseClient.query({ query: 'SELECT 1', format: 'JSON' });
                break;
            } catch {
                retries -= 1;
                await new Promise((resolve) => { setTimeout(resolve, 1000)});
            }
        }
        await clickhouseClient.command({ query: 'CREATE DATABASE IF NOT EXISTS activity' });
        await clickhouseClient.command({
            query: `CREATE TABLE IF NOT EXISTS activity.http_access (
                ts Int64,
                user String,
                email String,
                method String,
                path String,
                status Int32,
                duration Float64,
                ip String
            ) ENGINE = ReplacingMergeTree() ORDER BY ts`
        });
    });

    after(async function() {
        this.timeout(60000);
        if (clickhouseClient) {
            await clickhouseClient.close();
        }
        if (lokiContainer) {
            await lokiContainer.stop();
        }
        if (clickhouseContainer) {
            await clickhouseContainer.stop();
        }
    });

    it('streams loki entries to clickhouse', async function() {
        this.timeout(60000);
        const marker = Math.random().toString(36).slice(2);
        const app = `traefik${marker}`;
        const pipeline = activityTracking(lokiUrl, clickhouseUrl, `{app="${app}"}`, {
            poll: 0.5,
            size: 1,
            interval: 1,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const line = JSON.stringify({
            StartUTC: new Date().toISOString(),
            RequestMethod: 'GET',
            RequestPath: `/test/${marker}`,
            DownstreamStatus: 200,
            Duration: 1000000000,
            ClientHost: '127.0.0.1'
        });
        await pushToLoki(lokiUrl, { app }, line);
        const query = `SELECT * FROM activity.http_access WHERE path LIKE '%${marker}%'`;
        const rows = await poll(clickhouseClient, query, 1, 15000);
        pipeline.stop();
        assert(rows.length >= 1, 'expected at least one record in clickhouse');
    });

    it('stops streaming after stop is called', async function() {
        this.timeout(60000);
        const marker = Math.random().toString(36).slice(2);
        const app = `stop${marker}`;
        const pipeline = activityTracking(lokiUrl, clickhouseUrl, `{app="${app}"}`, {
            poll: 0.5,
            size: 1,
            interval: 1,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const line = JSON.stringify({
            StartUTC: new Date().toISOString(),
            RequestMethod: 'GET',
            RequestPath: `/before/${marker}`,
            DownstreamStatus: 200,
            Duration: 1000000000,
            ClientHost: '127.0.0.1'
        });
        await pushToLoki(lokiUrl, { app }, line);
        const query = `SELECT * FROM activity.http_access WHERE path LIKE '%${marker}%'`;
        const rowsBefore = await poll(clickhouseClient, query, 1, 15000);
        pipeline.stop();
        const afterLine = JSON.stringify({
            StartUTC: new Date().toISOString(),
            RequestMethod: 'GET',
            RequestPath: `/after/${marker}`,
            DownstreamStatus: 200,
            Duration: 1000000000,
            ClientHost: '127.0.0.1'
        });
        await pushToLoki(lokiUrl, { app }, afterLine);
        await new Promise((resolve) => { setTimeout(resolve, 3000)});
        const result = await clickhouseClient.query({ query, format: 'JSONEachRow' });
        const rowsAfter = await result.json();
        assert(rowsBefore.length >= 1, 'expected entry before stop');
        assert(rowsAfter.length === rowsBefore.length, 'expected no new entries after stop');
    });

    it('handles unicode log entries', async function() {
        this.timeout(60000);
        const marker = Math.random().toString(36).slice(2);
        const app = `unicode${marker}`;
        const pipeline = activityTracking(lokiUrl, clickhouseUrl, `{app="${app}"}`, {
            poll: 0.5,
            size: 1,
            interval: 1,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const line = JSON.stringify({
            StartUTC: new Date().toISOString(),
            RequestMethod: 'GET',
            RequestPath: `/запрос/${marker}`,
            DownstreamStatus: 200,
            Duration: 1000000000,
            ClientHost: '127.0.0.1'
        });
        await pushToLoki(lokiUrl, { app }, line);
        const query = `SELECT * FROM activity.http_access WHERE path LIKE '%${marker}%'`;
        const rows = await poll(clickhouseClient, query, 1, 15000);
        pipeline.stop();
        assert(rows.length >= 1, 'expected unicode entry in clickhouse');
    });

    it('captures all entries when two pipelines run in parallel', async function() {
        this.timeout(90000);
        const marker = Math.random().toString(36).slice(2);
        const app = `parallel${marker}`;
        const config = { poll: 0.5, size: 1, interval: 1, threshold: 5, timeout: 60 };
        const first = activityTracking(lokiUrl, clickhouseUrl, `{app="${app}"}`, config);
        const second = activityTracking(lokiUrl, clickhouseUrl, `{app="${app}"}`, config);
        first.start();
        second.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const count = 5;
        for (let i = 0; i < count; i += 1) {
            const line = JSON.stringify({
                StartUTC: new Date().toISOString(),
                RequestMethod: 'GET',
                RequestPath: `/entry/${marker}/${i}`,
                DownstreamStatus: 200,
                Duration: 1000000000,
                ClientHost: '127.0.0.1'
            });
            await pushToLoki(lokiUrl, { app }, line);
            await new Promise((resolve) => { setTimeout(resolve, 100)});
        }
        const query = `SELECT * FROM activity.http_access FINAL WHERE path LIKE '%${marker}%'`;
        await poll(clickhouseClient, query, count, 20000);
        await clickhouseClient.command({ query: 'OPTIMIZE TABLE activity.http_access FINAL' });
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const result = await clickhouseClient.query({ query, format: 'JSONEachRow' });
        const rows = await result.json();
        assert.strictEqual(rows.length, count, `expected ${count} deduplicated records`);
        first.stop();
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const additional = JSON.stringify({
            StartUTC: new Date().toISOString(),
            RequestMethod: 'GET',
            RequestPath: `/additional/${marker}`,
            DownstreamStatus: 200,
            Duration: 1000000000,
            ClientHost: '127.0.0.1'
        });
        await pushToLoki(lokiUrl, { app }, additional);
        await poll(clickhouseClient, query, count + 1, 15000);
        await clickhouseClient.command({ query: 'OPTIMIZE TABLE activity.http_access FINAL' });
        const final = await clickhouseClient.query({ query, format: 'JSONEachRow' });
        const finalRows = await final.json();
        assert.strictEqual(finalRows.length, count + 1, 'expected second pipeline to capture entry after first stopped');
        second.stop();
    });
});
