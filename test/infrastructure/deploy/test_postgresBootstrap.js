import assert from 'node:assert/strict';
import { postgresBootstrapObjects, postgresRuntimeRoleJob } from '../../../src/infrastructure/deploy/postgresBootstrap.js';

const fixture = {
    namespace: 'cell',
    authConfigMap: 'store-auth',
    schemaConfigMap: 'store-schema',
    ownerRole: 'db_owner',
    runtimeRole: 'db_agent'
};

describe('PostgreSQL bootstrap deployment', () => {
    it('denies unknown clients after explicitly declared IPv4 and IPv6 subnets', () => {
        const [auth] = postgresBootstrapObjects(fixture, ['192.0.2.0/24', '2001:db8::/64']);
        assert.deepStrictEqual(auth.metadata, { name: 'store-auth', namespace: 'cell' });
        assert.strictEqual(auth.data['pg_hba.conf.fragment'], [
            '# DSL target pod CIDRs',
            'host all all 192.0.2.0/24 scram-sha-256',
            'host all all 2001:db8::/64 scram-sha-256',
            'host all all 0.0.0.0/0 reject',
            'host all all ::/0 reject',
            ''
        ].join('\n'));
        assert.match(auth.data['entrypoint.sh'], /exec \/usr\/local\/bin\/docker-entrypoint.sh postgres/u);
        assert.throws(() => { postgresBootstrapObjects(fixture, ['192.0.2.0/33']); }, /Invalid target pod CIDR/u);
    });

    it('installs the baseline with separate roles and rejects invalid role names', () => {
        const [,schema] = postgresBootstrapObjects(fixture);
        assert.deepStrictEqual(schema.metadata, { name: 'store-schema', namespace: 'cell' });
        const sql = schema.data['schema.sql'];
        assert.match(sql, /CREATE ROLE db_agent NOLOGIN/u);
        assert.match(sql, /public\.user_decisions OWNER TO db_owner/u);
        assert.match(sql, /REVOKE DELETE ON alerts FROM db_agent/u);
        assert.throws(() => { postgresBootstrapObjects({ ...fixture, runtimeRole: "agent';DROP" }); }, /Invalid PostgreSQL bootstrap roles/u);
    });

    it('uses a repeatable image revision and resolves credentials at runtime', () => {
        const input = {
            namespace: 'cell', namePrefix: 'store-login', image: 'example.invalid/repair:1',
            pullSecret: 'registry-key', credentials: 'database-key', command: ['node', '/run/repair.js']
        };
        const job = postgresRuntimeRoleJob(input);
        assert.deepStrictEqual(postgresRuntimeRoleJob(input), job);
        assert.notStrictEqual(postgresRuntimeRoleJob({ ...input, image: 'example.invalid/repair:2' }).metadata.name, job.metadata.name);
        const pod = job.spec.template.spec;
        assert.strictEqual(pod.automountServiceAccountToken, false);
        assert.strictEqual(pod.containers[0].securityContext.readOnlyRootFilesystem, true);
        assert.deepStrictEqual(pod.containers[0].env[0], {
            name: 'POSTGRES_URL', valueFrom: { secretKeyRef: { name: 'database-key', key: 'POSTGRES_URL' } }
        });
    });
});
