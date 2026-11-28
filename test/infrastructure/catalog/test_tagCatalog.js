import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import tagCatalog from '../../../src/infrastructure/catalog/tagCatalog.js';
import catalogRoute from '../../../src/infrastructure/http/plant/routes/catalogRoute.js';

const path = fileURLToPath(new URL('./fixture.json', import.meta.url));

async function catalogResponse(catalog) {
    const [endpoint] = catalogRoute('/api/v1', catalog);
    let body;
    const response = {
        writeHead() {},
        end(payload) {
            body = JSON.parse(payload);
        }
    };
    await endpoint.handle({ method: 'GET', url: '/api/v1/tag-catalog', headers: {} }, response, {});
    return body;
}

describe('tagCatalog', function () {
    it('starts with an empty catalog when no file is configured', function () {
        assert.deepEqual(tagCatalog({}).entries(), []);
    });

    it('loads the configured hierarchy and labels from disk', function () {
        const catalog = tagCatalog({ TAG_CATALOG_PATH: path });
        assert.deepEqual(catalog.children('parent'), ['leaf']);
        assert.deepEqual(catalog.get('leaf'), { id: 'leaf', label: 'Leaf', parent: 'parent' });
        assert.deepEqual(catalog.labels(), { parent: 'Parent', leaf: 'Leaf' });
    });
});

describe('catalogRoute', function () {
    it('exposes an empty catalog without configuration', async function () {
        assert.deepEqual(await catalogResponse(tagCatalog({})), { items: [] });
    });

    it('serves the supplied catalog unchanged', async function () {
        assert.deepEqual(await catalogResponse(tagCatalog({ TAG_CATALOG_PATH: path })), {
            items: [{ id: 'parent', label: 'Parent', parent: null },
                { id: 'leaf', label: 'Leaf', parent: 'parent' }]
        });
    });
});
