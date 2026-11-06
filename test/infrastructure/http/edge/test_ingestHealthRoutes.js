import assert from 'node:assert/strict';
import http from 'node:http';
import { createEdgeApi } from '../../../../src/infrastructure/http/edge/edgeApi.js';
import stateDataFake from '../../../helpers/stateDataFake.js';

describe('ingest health HTTP routes', () => {
    it('reflects loss of readers and fatal state independently from the state API', async () => {
        const status = { ready: false, live: true };
        const api = createEdgeApi(stateDataFake({}), { metricsEnabled: false, health: () => {return status} });
        const server = http.createServer((req, res) => {return api.handle(req, res)});
        await new Promise(resolve => { server.listen(0, '127.0.0.1', resolve); });
        const url = `http://127.0.0.1:${server.address().port}`;
        try {
            assert.equal((await fetch(`${url}/ready`)).status, 503);
            assert.equal((await fetch(`${url}/live`)).status, 200);
            status.ready = true;assert.equal((await fetch(`${url}/ready`)).status, 200);
            status.live = false;status.ready = false;
            assert.equal((await fetch(`${url}/live`)).status, 503);
            assert.equal((await fetch(`${url}/ready`)).status, 503);
        } finally { server.closeAllConnections();await new Promise(resolve => { server.close(resolve); }); }
    });
});
