import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';

const databaseAssets = new URL('../../../db/', import.meta.url);

function asset(name) {
    return readFileSync(new URL(name, databaseAssets), 'utf8');
}

function authData(podCidrs) {
    const allowed = podCidrs.map((cidr) => {
        const [address, bits, extra] = cidr.split('/');
        const version = isIP(address);
        const prefix = Number(bits);
        if (extra !== undefined || !version || !Number.isInteger(prefix) || prefix < 1 || prefix > (version === 4 ? 32 : 128)) {
            throw new Error('Invalid target pod CIDR');
        }
        return `host all all ${cidr} scram-sha-256`;
    });
    return {
        'pg_hba.conf.fragment': ['# DSL target pod CIDRs', ...allowed, 'host all all 0.0.0.0/0 reject', 'host all all ::/0 reject', ''].join('\n'),
        'entrypoint.sh': asset('bootstrap/entrypoint.sh'),
        'apply-hba.sh': asset('bootstrap/apply-hba.sh')
    };
}

function schemaData(ownerRole, runtimeRole) {
    const roles = [ownerRole, runtimeRole];
    if (ownerRole === runtimeRole || roles.some((role) => { return typeof role !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/u.test(role); })) {
        throw new TypeError('Invalid PostgreSQL bootstrap roles');
    }
    const ownership = asset('bootstrap/ownership.sql')
        .replaceAll('@RUNTIME_ROLE@', runtimeRole).replaceAll('@OWNER_ROLE@', ownerRole);
    const grants = asset('migrations/C0002__central_revoke_delete.sql').replaceAll('supervisor_sink', runtimeRole);
    const sql = [
        asset('migrations/V0001__baseline.sql'), asset('migrations/V0002__sink_extension_tables.sql'),
        ownership, grants
    ].map((part) => { return part.trimEnd(); }).join('\n\n');
    return { 'schema.sql': `${sql}\n`, 'zz-auth.sh': asset('bootstrap/zz-auth.sh') };
}

/** Render PostgreSQL bootstrap ConfigMaps using an installation's names and CIDRs. */
export function postgresBootstrapObjects({ namespace, authConfigMap, schemaConfigMap, ownerRole, runtimeRole }, podCidrs = []) {
    return [
        { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: authConfigMap, namespace }, data: authData(podCidrs) },
        { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: schemaConfigMap, namespace }, data: schemaData(ownerRole, runtimeRole) }
    ];
}

function roleContainer({ image, command, credentials, resources }) {
    return {
        name: 'runtime-role', image, command,
        env: ['POSTGRES_URL', 'POSTGRES_ADMIN_URL'].map((key) => {
            return { name: key, valueFrom: { secretKeyRef: { name: credentials, key } } };
        }),
        resources: resources ?? { requests: { cpu: '10m', memory: '64Mi' }, limits: { cpu: '250m', memory: '256Mi' } },
        securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } }
    };
}

/** Bind the runtime-role setup job to a selected application image and Secret. */
export function postgresRuntimeRoleJob(settings) {
    const { namespace, namePrefix, image, pullSecret } = settings;
    const revision = createHash('sha256').update(image).digest('hex').slice(0, 12);
    return {
        apiVersion: 'batch/v1', kind: 'Job', metadata: { name: `${namePrefix}-${revision}`, namespace },
        spec: {
            backoffLimit: 4, activeDeadlineSeconds: 300,
            template: {
                spec: {
                    restartPolicy: 'OnFailure', automountServiceAccountToken: false,
                    imagePullSecrets: [{ name: pullSecret }], securityContext: { runAsNonRoot: true, runAsUser: 1000 },
                    containers: [roleContainer(settings)]
                }
            }
        }
    };
}
