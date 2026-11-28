function quote(value) {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Runs PostgreSQL with a local socket inside the isolated restore container. */
function restoreScript({ database, restoreRole, verificationSql }) {
    const verify = verificationSql ? `psql -v ON_ERROR_STOP=1 -At -c ${quote(verificationSql)}` : "printf '{}\\n'";
    return `set -eu
export PGDATA=/restore/pgdata PGHOST=/tmp PGPORT=55432 PGUSER=${restoreRole} PGDATABASE=${database}
cd /backup
sha256sum -c complete >/restore/checksum.log
initdb -D "$PGDATA" -U ${restoreRole} --auth=trust >/restore/initdb.log
pg_ctl -D "$PGDATA" -l /restore/postgres.log -o "-p 55432 -k /tmp -c listen_addresses='' -c shared_buffers=16MB -c maintenance_work_mem=32MB -c max_connections=10" -w start
trap 'pg_ctl -D "$PGDATA" -m fast -w stop >/restore/stop.log' EXIT
sed '/^CREATE ROLE ${restoreRole};$/d; /^CREATE ROLE "${restoreRole}";$/d' /backup/roles.sql | psql -v ON_ERROR_STOP=1 -d postgres >/restore/roles.log
createdb ${database}
pg_restore --exit-on-error --dbname=${database} /backup/${database}.dump 2>/restore/restore-errors.log
${verify}
printf 'RESTORE_VERIFIED\\n'
`;
}

function verificationContainer(plan, image) {
    return {
        name: 'restore',
        image,
        command: ['/bin/sh', '-ceu', restoreScript(plan)],
        resources: { requests: { cpu: '100m', memory: '256Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        volumeMounts: [
            { name: 'backup', mountPath: '/backup', subPath: `${plan.backupSubdirectory}/${plan.backupId}`, readOnly: true },
            { name: 'scratch', mountPath: '/restore' }
        ]
    };
}

/** An isolated restore job reads the source backup and writes only to fresh scratch. */
export default function postgresRestoreObjects(plan, nodeName, image) {
    const { verificationName: name, namespace, labels } = plan;
    const metadata = { name, namespace, labels };
    return [
        {
            apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata,
            spec: { accessModes: ['ReadWriteOnce'], storageClassName: plan.storageClass, resources: { requests: { storage: plan.scratchSize } } }
        },
        {
            apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata,
            spec: { podSelector: { matchLabels: labels }, policyTypes: ['Ingress', 'Egress'], ingress: [], egress: [] }
        },
        {
            apiVersion: 'batch/v1', kind: 'Job', metadata,
            spec: {
                backoffLimit: 0,
                activeDeadlineSeconds: 1800,
                template: {
                    metadata: { labels },
                    spec: {
                        nodeSelector: { 'kubernetes.io/hostname': nodeName },
                        restartPolicy: 'Never',
                        automountServiceAccountToken: false,
                        imagePullSecrets: plan.imagePullSecrets,
                        securityContext: { runAsUser: plan.userId, runAsGroup: plan.groupId, fsGroup: plan.groupId, runAsNonRoot: true },
                        containers: [verificationContainer(plan, image)],
                        volumes: [
                            { name: 'backup', persistentVolumeClaim: { claimName: plan.claim, readOnly: true } },
                            { name: 'scratch', persistentVolumeClaim: { claimName: name } }
                        ]
                    }
                }
            }
        }
    ];
}
