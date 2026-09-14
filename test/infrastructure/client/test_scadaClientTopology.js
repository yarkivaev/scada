import assert from 'assert';
import scadaClient from '../../../src/infrastructure/client/scadaClient.js';

describe('scadaClient topology', function() {
    it('fetches topology from the plant api', async function() {
        let fetchedUrl;
        const graph = { plant: { id: `plant-${Math.random()}` }, nodes: [], links: [] };
        const fakeFetch = async (url) => {
            fetchedUrl = url;
            return {
                ok: true,
                json: async () => {
                    return graph;
                }
            };
        };
        const client = scadaClient('http://localhost/api/v1', fakeFetch, function() {});
        const result = await client.topology();
        assert.strictEqual(
            fetchedUrl === 'http://localhost/api/v1/topology' && result.plant.id === graph.plant.id,
            true,
            'client did not fetch /topology'
        );
    });
});
