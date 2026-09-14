import assert from 'assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import plantApi from '../../../../../src/application/plantApi.js';
import plantDomain from '../../../../../src/domain/plant/plant.js';
import initialized from '../../../../../src/domain/shared/initialized.js';

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

function mockReq(url) {
    return {
        method: 'GET',
        url,
        headers: {},
        on() {
            return this;
        }
    };
}

function api() {
    return plantApi('/api/v1', plantDomain(initialized({}, Object.values)));
}

describe('infraRoute', function() {
    it('serves the topology page from site-server files', async function() {
        const res = mockRes();
        await api().handle(mockReq('/infra'), res);
        const html = res.body.toString();
        assert.strictEqual(
            html.includes('id="graph"') && res.headers['Content-Type'].startsWith('text/html'),
            true,
            'GET /infra did not serve the topology page'
        );
    });

    it('keeps factory names out of the generic topology page', async function() {
        const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../../../src/infrastructure/http/plant/ui');
        const text = ['infra.html', 'infra/app.js', 'infra/app.css', 'infra/graph.js', 'infra/panel.js']
            .map((name) => {
                return readFileSync(join(dir, name), 'utf8');
            })
            .join('\n');
        assert.strictEqual(
            /icht|ИЧТ|киоск|kiosk/iu.test(text),
            false,
            'infra UI still contains factory or kiosk copy'
        );
    });
});
