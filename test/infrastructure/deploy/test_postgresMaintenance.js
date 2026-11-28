import assert from 'node:assert/strict';
import operatePostgresMaintenance from '../../../src/infrastructure/deploy/operatePostgresMaintenance.js';
import postgresMaintenancePlan from '../../../src/infrastructure/deploy/postgresMaintenancePlan.js';
import postgresRestoreObjects from '../../../src/infrastructure/deploy/postgresRestoreObjects.js';

const options = {
    context: 'workshop-west',
    namespace: 'maintenance',
    nodeAddress: '192.0.2.5',
    enabled: true,
    pod: 'data-store-0',
    claim: 'data-store-pvc',
    database: 'inventory',
    restoreRole: 'inventory',
    osUser: 'postgres',
    userId: 70,
    groupId: 70,
    runAs: 'su-exec',
    dataMount: '/var/lib/postgresql/data',
    backupSubdirectory: 'maintenance-backups',
    verificationNamePrefix: 'restore',
    backupLabel: 'example.com/backup',
    restoreLabels: { 'example.com/purpose': 'verify' },
    storageClass: 'workshop-disk',
    scratchSize: '4Gi',
    fieldManager: 'maintenance',
    imagePullSecrets: [{ name: 'workshop-registry' }],
    verificationSql: "SELECT json_build_object('items', 4);"
};
const id = '20261128-preflight';

describe('PostgreSQL maintenance targets', () => {
    it('uses caller-defined database, identity labels, and storage in the backup and isolated restore', () => {
        const plan = postgresMaintenancePlan(options, id, 2);
        const [claim, policy, job] = postgresRestoreObjects(plan, 'workshop', 'postgres@sha256:fixture');
        assert.equal(claim.metadata.name, `restore-${id}-r2`);
        assert.equal(claim.spec.resources.requests.storage, '4Gi');
        assert.equal(policy.spec.podSelector.matchLabels['example.com/backup'], id);
        assert.deepEqual(policy.spec.egress, []);
        const { spec } = job.spec.template;
        assert.equal(spec.automountServiceAccountToken, false);
        assert.deepEqual(spec.volumes[0].persistentVolumeClaim, { claimName: options.claim, readOnly: true });
        assert.equal(spec.containers[0].volumeMounts[0].subPath, `maintenance-backups/${id}`);
        assert.match(spec.containers[0].command.at(-1), /pg_restore --exit-on-error --dbname=inventory \/backup\/inventory.dump/u);
        assert.match(plan.backupCommand.at(-1), /--file=inventory.dump.partial/u);
        assert.throws(() => { postgresMaintenancePlan(options, '../unsafe'); }, /backup id/u);
    });

    it('rejects a valid pod and node if the pod attaches a different claim', () => {
        const calls = [];
        const plan = postgresMaintenancePlan(options, id);
        const execute = (_command, args) => {
            calls.push(args);
            if (args.includes('nodes')) {
                return '{"items":[{"metadata":{"name":"workshop"},"status":{"addresses":[{"type":"InternalIP","address":"192.0.2.5"}]}}]}';
            }
            return '{"spec":{"nodeName":"workshop","volumes":[{"persistentVolumeClaim":{"claimName":"unexpected-pvc"}}]}}';
        };
        assert.throws(() => { operatePostgresMaintenance(plan, 'backup', execute); }, /claim identity/u);
        assert.equal(calls.length, 2);
        assert(calls.every((args) => { return args.includes('get'); }));
    });
});
