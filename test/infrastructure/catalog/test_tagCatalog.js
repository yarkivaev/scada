import assert from 'node:assert/strict';
import tagCatalog from '../../../src/infrastructure/catalog/tagCatalog.js';
import catalogRoute from '../../../src/infrastructure/http/plant/routes/catalogRoute.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

describe('tagCatalog', function () {
    it('loads embedded catalog with heating under on', function () {
        const catalog = tagCatalog({});
        assert.equal(
            catalog.get('heating').parent,
            'on',
            'heating was not parented to on'
        );
        assert.ok(
            catalog.children('off').includes('idle'),
            'off roots did not include idle'
        );
    });

    it('reads labels for a leaf reason', function () {
        const catalog = tagCatalog({});
        assert.equal(
            catalog.labels().maintenance,
            'Maintenance',
            'maintenance label was missing'
        );
    });

    it('loads catalog from TAG_CATALOG_PATH override', function () {
        const path = join(dirname(fileURLToPath(import.meta.url)), '../../../src/infrastructure/catalog/tag-catalog.json');
        const catalog = tagCatalog({ TAG_CATALOG_PATH: path });
        assert.ok(catalog.entries().length >= 3, 'override catalog was too small');
    });
});

describe('catalogRoute', function () {
    it('exposes GET tag-catalog items', async function () {
        const [endpoint] = catalogRoute('/api/v1', tagCatalog({}));
        let body;
        const res = {
            writeHead() {},
            end(payload) {
                body = JSON.parse(payload);
            }
        };
        await endpoint.handle({ method: 'GET', url: '/api/v1/tag-catalog', headers: {} }, res, {});
        assert.ok(Array.isArray(body.items), 'tag-catalog response had no items array');
    });
    it('includes heating among tag-catalog items', async function () {
        const [endpoint] = catalogRoute('/api/v1', tagCatalog({}));
        let body;
        const res = {
            writeHead() {},
            end(payload) {
                body = JSON.parse(payload);
            }
        };
        await endpoint.handle({ method: 'GET', url: '/api/v1/tag-catalog', headers: {} }, res, {});
        assert.ok(body.items.some((row) => {
            return row.id === 'heating';
        }), 'heating missing from API catalog');
    });
});
