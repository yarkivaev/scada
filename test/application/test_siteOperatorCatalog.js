import assert from 'assert';
import siteOperatorCatalog, {
    buildSiteOperatorCatalog
} from '../../src/application/siteOperatorCatalog.js';

describe('buildSiteOperatorCatalog', function() {
    it('uses built-in catalog when operatorCatalog option is omitted', function() {
        const sink = { sinkDbProfile: 'unknown' };
        const catalog = buildSiteOperatorCatalog({}, '/api/v1', sink, {});
        assert.deepStrictEqual(
            catalog.routes,
            [],
            'omitted operatorCatalog did not fall back to built-in empty catalog'
        );
    });

    it('uses injected operatorCatalog instead of built-in factory', function() {
        const marker = `plant-${Math.random().toString(36).slice(2)}`;
        const injected = {
            routes: [{ method: 'GET', path: `/api/v1/operators/${marker}` }],
            provider: { id: marker },
            sync: undefined,
            decisions: undefined
        };
        const catalog = buildSiteOperatorCatalog(
            {
                operatorCatalog() {
                    return injected;
                }
            },
            '/api/v1',
            { sinkDbProfile: 'central', pool: {} },
            {}
        );
        assert.strictEqual(
            catalog.provider.id,
            marker,
            'injected operatorCatalog was not used for site catalog provider'
        );
    });

    it('exposes default siteOperatorCatalog as callable factory', function() {
        const catalog = siteOperatorCatalog('/api/v1', { sinkDbProfile: 'unknown' }, {});
        assert.strictEqual(
            typeof catalog.routes.length,
            'number',
            'default siteOperatorCatalog did not return routes array'
        );
    });
});
