/* eslint-disable no-await-in-loop */
import assert from 'assert';
import { after, before, describe, it } from 'mocha';
import { GenericContainer } from 'testcontainers';
import mqtt from 'mqtt';
import { createClient } from '@clickhouse/client';
import { clickhouseSink } from '@yarkivaev/source-to-sink';
import ciContainerImage from '../../../../helpers/ciContainerImage.js';
import mqttMetrics from '../../../../../src/infrastructure/ingest/mqtt/mqttMetrics.js';

describe('mqttMetrics pipeline integration', function() {
    let mqttContainer;
    let clickhouseContainer;
    let mqttUrl;
    let clickhouseUrl;
    let publisher;
    let clickhouseClient;

    before(async function() {
        this.timeout(180000);
        const [mqttC, chC] = await Promise.all([
            new GenericContainer(ciContainerImage('eclipse-mosquitto', '2'))
                .withExposedPorts(1883)
                .withCommand(['mosquitto', '-c', '/mosquitto-no-auth.conf'])
                .withStartupTimeout(30000)
                .start(),
            new GenericContainer(ciContainerImage('clickhouse-server', '24'))
                .withExposedPorts(8123)
                .withStartupTimeout(60000)
                .start()
        ]);
        mqttContainer = mqttC;
        clickhouseContainer = chC;
        const mqttHost = mqttContainer.getHost();
        const mqttPort = mqttContainer.getMappedPort(1883);
        mqttUrl = `mqtt://${mqttHost}:${mqttPort}`;
        const chHost = clickhouseContainer.getHost();
        const chPort = clickhouseContainer.getMappedPort(8123);
        clickhouseUrl = `http://${chHost}:${chPort}`;
        publisher = mqtt.connect(mqttUrl);
        await new Promise((resolve, reject) => {
            publisher.on('connect', resolve);
            publisher.on('error', reject);
            setTimeout(() => { reject(new Error('MQTT connection timeout')); }, 10000);
        });
        clickhouseClient = createClient({ url: clickhouseUrl });
        let retries = 30;
        while (retries > 0) {
            try {
                await clickhouseClient.query({ query: 'SELECT 1', format: 'JSON' });
                break;
            } catch {
                retries -= 1;
                await new Promise((resolve) => { setTimeout(resolve, 1000)});
            }
        }
        await clickhouseClient.command({ query: 'CREATE DATABASE IF NOT EXISTS scada' });
        await clickhouseClient.command({
            query: `CREATE TABLE IF NOT EXISTS scada.metrics (
                topic String,
                ts DateTime64(3),
                value Float64
            ) ENGINE = ReplacingMergeTree() ORDER BY (topic, ts)`
        });
    });

    after(async function() {
        this.timeout(60000);
        if (publisher) {
            publisher.end();
        }
        if (clickhouseClient) {
            await clickhouseClient.close();
        }
        if (mqttContainer) {
            await mqttContainer.stop();
        }
        if (clickhouseContainer) {
            await clickhouseContainer.stop();
        }
    });

    it('streams mqtt messages to clickhouse', async function() {
        this.timeout(30000);
        const topic = `sensors/${Math.random().toString(36).slice(2)}`;
        const pipeline = mqttMetrics(mqttUrl, clickhouseSink(clickhouseUrl, 'scada.metrics'), topic, {
            size: 1,
            interval: 1,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const record = { topic, ts: Date.now(), value: Math.random() * 100 };
        publisher.publish(topic, JSON.stringify(record));
        await new Promise((resolve) => { setTimeout(resolve, 3000)});
        pipeline.stop();
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const result = await clickhouseClient.query({
            query: `SELECT * FROM scada.metrics WHERE topic = '${topic}'`,
            format: 'JSONEachRow'
        });
        const rows = await result.json();
        assert(rows.length >= 1, 'expected at least one record in clickhouse');
    });

    it('batches multiple messages before flush', async function() {
        this.timeout(30000);
        const topic = `batch/${Math.random().toString(36).slice(2)}`;
        const pipeline = mqttMetrics(mqttUrl, clickhouseSink(clickhouseUrl, 'scada.metrics'), topic, {
            size: 3,
            interval: 10,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        for (let i = 0; i < 3; i += 1) {
            const record = { topic, ts: Date.now() + i, value: Math.random() * 100 };
            publisher.publish(topic, JSON.stringify(record));
        }
        await new Promise((resolve) => { setTimeout(resolve, 3000)});
        pipeline.stop();
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const result = await clickhouseClient.query({
            query: `SELECT * FROM scada.metrics WHERE topic = '${topic}'`,
            format: 'JSONEachRow'
        });
        const rows = await result.json();
        assert(rows.length >= 3, 'expected at least three records after batch flush');
    });

    it('handles unicode sensor data', async function() {
        this.timeout(30000);
        const topic = `sensor/${Math.random().toString(36).slice(2)}`;
        const pipeline = mqttMetrics(mqttUrl, clickhouseSink(clickhouseUrl, 'scada.metrics'), topic, {
            size: 1,
            interval: 1,
            threshold: 5,
            timeout: 60
        });
        pipeline.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const record = { topic, ts: Date.now(), value: Math.random() };
        publisher.publish(topic, JSON.stringify(record));
        await new Promise((resolve) => { setTimeout(resolve, 3000)});
        pipeline.stop();
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const result = await clickhouseClient.query({
            query: `SELECT * FROM scada.metrics WHERE topic LIKE 'sensor/%'`,
            format: 'JSONEachRow'
        });
        const rows = await result.json();
        assert(rows.length >= 1, 'expected unicode record in clickhouse');
    });

    it('captures all messages when two pipelines run in parallel', async function() {
        this.timeout(60000);
        const topic = `parallel/${Math.random().toString(36).slice(2)}`;
        const config = { size: 1, interval: 1, threshold: 5, timeout: 60 };
        const first = mqttMetrics(mqttUrl, clickhouseSink(clickhouseUrl, 'scada.metrics'), topic, config);
        const second = mqttMetrics(mqttUrl, clickhouseSink(clickhouseUrl, 'scada.metrics'), topic, config);
        first.start();
        second.start();
        await new Promise((resolve) => { setTimeout(resolve, 2000)});
        const count = 5;
        const base = Date.now();
        for (let i = 0; i < count; i += 1) {
            const record = { topic, ts: base + i * 10, value: Math.random() * 100 };
            publisher.publish(topic, JSON.stringify(record));
            await new Promise((resolve) => { setTimeout(resolve, 50)});
        }
        await new Promise((resolve) => { setTimeout(resolve, 5000)});
        await clickhouseClient.command({ query: 'OPTIMIZE TABLE scada.metrics FINAL' });
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const result = await clickhouseClient.query({
            query: `SELECT * FROM scada.metrics FINAL WHERE topic = '${topic}'`,
            format: 'JSONEachRow'
        });
        const rows = await result.json();
        assert.strictEqual(rows.length, count, `expected ${count} deduplicated records`);
        first.stop();
        await new Promise((resolve) => { setTimeout(resolve, 1000)});
        const additional = { topic, ts: base + count * 10, value: Math.random() * 100 };
        publisher.publish(topic, JSON.stringify(additional));
        await new Promise((resolve) => { setTimeout(resolve, 3000)});
        await clickhouseClient.command({ query: 'OPTIMIZE TABLE scada.metrics FINAL' });
        const final = await clickhouseClient.query({
            query: `SELECT * FROM scada.metrics FINAL WHERE topic = '${topic}'`,
            format: 'JSONEachRow'
        });
        const finalRows = await final.json();
        assert.strictEqual(finalRows.length, count + 1, 'expected second pipeline to capture message after first stopped');
        second.stop();
    });
});
