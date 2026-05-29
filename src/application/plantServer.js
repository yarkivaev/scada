import http from 'http';
import { stompSource } from '@yarkivaev/source-to-sink';
import plantApi from './plantApi.js';
import pgAlerts from '../infrastructure/persistence/pg/alerts.js';
import postgresPool from '../infrastructure/persistence/postgresPool.js';
import stompAlerts from '../infrastructure/messaging/stomp/alerts/stompAlerts.js';
import userDecisions from '../infrastructure/messaging/stomp/userDecisions.js';
import { parseRequestTimeoutMs, virtualClock } from '@yarkivaev/simple-server';

function stompCollectorFactory(stompUrl, destination, credentials) {
    return (collector) => {
        const src = stompSource(stompUrl, destination, collector, credentials);
        src.start();
        return src;
    };
}

async function initStomp(stomp, translations, requirePool) {
    if (!stomp || !stomp.url) {
        return {};
    }
    const pool = postgresPool({});
    if (requirePool && !pool) {
        throw new Error('SUPERVISOR_STATE_PG_URL is required for plant server alerts');
    }
    const credentials = { login: stomp.login, passcode: stomp.passcode, host: stomp.host };
    let alerts;
    if (pool) {
        alerts = stompAlerts(pgAlerts(pool), stompCollectorFactory(stomp.url, '/exchange/scada.alerts', credentials), translations || {});
        await alerts.init();
    }
    const decisions = userDecisions({
        stompUrl: stomp.url,
        user: stomp.operatorUser,
        login: stomp.login,
        passcode: stomp.passcode,
        host: stomp.host
    });
    return { alerts, userDecisions: decisions };
}

/**
 * Generic HTTP plant server with optional STOMP alerts and user decisions.
 *
 * @param {object} config - port, basePath, plantFactory, extraRoutes, translations, stomp, requirePool
 * @returns {Promise<object>} server, plant, api
 *
 * @example
 *   await plantServer({ port: 3000, basePath: '/api/v1', plantFactory, extraRoutes });
 */
export default async function plantServer(config) {
    const { alerts, userDecisions: decisions } = await initStomp(config.stomp, config.translations, config.requirePool);
    const p = await config.plantFactory({ alerts, userDecisions: decisions });
    const clock = virtualClock(() => {
        return new Date();
    });
    const requestTimeoutMs = parseRequestTimeoutMs(process.env.REQUEST_TIMEOUT_MS);
    const basePath = config.basePath || '/api/v1';
    const extra = config.extraRoutes ? config.extraRoutes(basePath, p, clock) : [];
    const api = plantApi(basePath, p, {
        clock,
        heartbeat: config.heartbeat || 1000,
        requestTimeoutMs,
        extraRoutes: extra
    });
    const server = http.createServer((req, res) => {
        return api.handle(req, res);
    });
    await new Promise((resolve) => {
        server.listen(config.port, resolve);
    });
    return { server, plant: p, api };
}
