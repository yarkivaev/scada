import assert from 'assert';
import metricsSensor from '../../../../src/infrastructure/http/edge/metricsSensor.js';

describe('metricsSensor', function() {
    it('name returns display label', function() {
        const label = `Voltage_${Math.random()}`;
        const client = {
            async getJson() {
                return { found: false };
            },
            async patchJson() {
                return {};
            },
            async postJson() {
                return {};
            }
        };
        const topic = `sensor/${Math.random()}`;
        const sensor = metricsSensor(client, topic, label, 'V');
        assert.strictEqual(sensor.name(), label, 'name did not match display label');
    });

    it('current queries provided topic', async function() {
        const topic = `metrics/${Math.random()}`;
        let queried = '';
        const client = {
            async getJson(path, query) {
                queried = query.topic;
                return { found: false };
            },
            async patchJson() {
                return {};
            },
            async postJson() {
                return {};
            }
        };
        await metricsSensor(client, topic, 'U', 'V').current();
        assert.strictEqual(queried, topic, 'topic did not match metrics key');
    });
});
