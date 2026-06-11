import assert from 'assert';
import ciContainerImage, { resolveCiContainerImage } from './ciContainerImage.js';

describe('ciContainerImage', () => {
    it('local default resolves postgres to public Docker Hub image', () => {
        assert.strictEqual(
            resolveCiContainerImage('postgres', '16-alpine', {}),
            'postgres:16-alpine'
        );
    });

    it('local default resolves rabbitmq mirror to public Docker Hub image', () => {
        assert.strictEqual(
            resolveCiContainerImage('rabbitmq-management-alpine', '3.13', {}),
            'rabbitmq:3.13-management-alpine'
        );
    });

    it('CI_CONTAINER_REGISTRY set resolves to mirror path', () => {
        assert.strictEqual(
            resolveCiContainerImage('postgres', '16-alpine', {
                CI_CONTAINER_REGISTRY: 'registry.example.com/mirror'
            }),
            'registry.example.com/mirror/postgres:16-alpine'
        );
    });

    it('CI_CONTAINER_REGISTRY set resolves clickhouse-server mirror path', () => {
        assert.strictEqual(
            resolveCiContainerImage('clickhouse-server', '24', {
                CI_CONTAINER_REGISTRY: 'registry.example.com/mirror'
            }),
            'registry.example.com/mirror/clickhouse-server:24'
        );
    });

    it('CI_CONTAINER_REGISTRY set resolves loki mirror path', () => {
        assert.strictEqual(
            resolveCiContainerImage('loki', '2.9.0', {
                CI_CONTAINER_REGISTRY: 'registry.example.com/mirror'
            }),
            'registry.example.com/mirror/loki:2.9.0'
        );
    });

    it('CI_CONTAINER_REGISTRY set resolves eclipse-mosquitto mirror path', () => {
        assert.strictEqual(
            resolveCiContainerImage('eclipse-mosquitto', '2', {
                CI_CONTAINER_REGISTRY: 'registry.example.com/mirror'
            }),
            'registry.example.com/mirror/eclipse-mosquitto:2'
        );
    });

    it('TESTCONTAINERS_POSTGRES_IMAGE override wins', () => {
        assert.strictEqual(
            resolveCiContainerImage('postgres', '16-alpine', {
                TESTCONTAINERS_POSTGRES_IMAGE: 'custom/postgres:99',
                CI_CONTAINER_REGISTRY: 'registry.example.com/mirror'
            }),
            'custom/postgres:99'
        );
    });

    it('default export uses process.env', () => {
        assert.strictEqual(typeof ciContainerImage('postgres', '16-alpine'), 'string');
    });
});
