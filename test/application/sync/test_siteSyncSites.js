import assert from 'assert';
import siteSyncSites from '../../../src/application/sync/siteSyncSites.js';

describe('siteSyncSites', function() {
    it('keeps SYNC_SITES ahead of EDGE_SITES for the same id', function() {
        const token = `\u00e9${Math.random().toString(36).slice(2)}`;
        const sites = siteSyncSites({
            SYNC_SITES: JSON.stringify([{ id: 'edge-icht-1', url: `http://sync-${token}/api/v1` }]),
            EDGE_SITES: JSON.stringify([{
                id: 'edge-icht-1',
                baseUrl: 'http://edge/api/v1',
                machines: ['icht1']
            }])
        });
        assert.strictEqual(
            sites[0].url.includes(token),
            true,
            'siteSyncSites did not prefer SYNC_SITES over EDGE_SITES'
        );
    });

    it('derives an id from the first EDGE_SITES machine', function() {
        const host = `192.168.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
        const sites = siteSyncSites({
            EDGE_SITES: JSON.stringify([{
                baseUrl: `http://${host}:30300/api/v1`,
                machines: ['icht3']
            }])
        });
        assert.strictEqual(sites[0].id, 'icht3', 'siteSyncSites did not derive id from machines');
    });

    it('adds central from CENTRAL_PLANT_URL', function() {
        const url = `http://central-${Math.random().toString(36).slice(2)}/api/v1`;
        const sites = siteSyncSites({ CENTRAL_PLANT_URL: url });
        assert.strictEqual(sites[0].id, 'central', 'siteSyncSites did not register central');
    });
});
