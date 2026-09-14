import assert from 'assert';
import inspectRoute from '../../../../../src/infrastructure/http/plant/routes/inspectRoute.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';
import plantApi from '../../../../../src/application/plantApi.js';

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        headersSent: false,
        writeHead(code, headers) {
            this.statusCode = code;
            this.headers = headers || {};
        },
        end(data) {
            this.body = data;
        }
    };
}

function mockReq(url, host) {
    return {
        method: 'GET',
        url,
        headers: { host: host || 'example.test:443' },
        on() {
            return this;
        }
    };
}

function graphPlant() {
    return plantDomain(initialized({}, Object.values), { topology() {
        return {
            plant: { id: 'plant-a', title: 'Plant A' },
            nodes: [
                {
                    id: 'm1',
                    kind: 'machine',
                    title: 'M1',
                    inspect: { host: '127.0.0.1', port: 9222 }
                }
            ],
            links: []
        };
    } });
}

describe('inspectRoute', function() {
    it('proxies debugger json through the plant inspect path', async function() {
        const routes = inspectRoute(graphPlant(), {
            async json() {
                return JSON.stringify({
                    webSocketDebuggerUrl: 'wss://example.test/infra/inspect/m1/devtools/page/x'
                });
            }
        });
        const matching = routes.find((item) => {
            return item.matches(mockReq('/infra/inspect/m1/json/list'));
        });
        const res = mockRes();
        await matching.handle(mockReq('/infra/inspect/m1/json/list'), res);
        assert.strictEqual(
            JSON.parse(res.body).webSocketDebuggerUrl,
            'wss://example.test/infra/inspect/m1/devtools/page/x',
            'inspect json did not expose a same-origin debugger url'
        );
    });

    it('returns a png screenshot for an inspectable node', async function() {
        const png = Buffer.from([137, 80, 78, 71]);
        const routes = inspectRoute(graphPlant(), {
            async json() {
                return '{}';
            },
            async shot() {
                return png;
            }
        });
        const matching = routes.find((item) => {
            return item.matches(mockReq('/infra/inspect/m1/shot'));
        });
        const res = mockRes();
        await matching.handle(mockReq('/infra/inspect/m1/shot'), res);
        assert.strictEqual(
            res.headers['Content-Type'] === 'image/png' && Buffer.compare(res.body, png) === 0,
            true,
            'inspect shot did not return a png'
        );
    });

    it('does not serve inspect routes for a node without inspect', async function() {
        const p = plantDomain(initialized({}, Object.values), { topology() {
            return {
                plant: { id: 'plant-a', title: 'Plant A' },
                nodes: [{ id: 'm1', kind: 'machine', title: 'M1' }],
                links: []
            };
        } });
        const api = plantApi('/api/v1', p);
        const res = mockRes();
        await api.handle(mockReq('/infra/inspect/m1/json/list'), res);
        assert.strictEqual(res.statusCode, 404, 'missing inspect still proxied to a debug port');
    });
});
