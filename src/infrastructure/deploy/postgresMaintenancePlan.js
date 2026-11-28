function quote(value) {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function backupCommand({ directory, database, backupRoot, osUser, runAs }) {
    const script = `set -eu
umask 077
backup=${quote(directory)}
mkdir -p "$backup"
cd "$backup"
lock="$backup/.lock"
if ! mkdir "$lock" 2>/dev/null; then echo 'Backup already in progress' >&2; exit 75; fi
trap 'rmdir "$lock"' EXIT
if [ -f complete ]; then sha256sum -c complete; exit 0; fi
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dumpall -U "$POSTGRES_USER" --globals-only > roles.sql.partial
pg_dump -U "$POSTGRES_USER" -d ${quote(database)} --format=custom --file=${database}.dump.partial
mv roles.sql.partial roles.sql
mv ${database}.dump.partial ${database}.dump
sha256sum roles.sql ${database}.dump > complete.partial
mv complete.partial complete
sha256sum -c complete
`;
    return ['sh', '-ceu', `set -eu; umask 077; mkdir -p ${quote(directory)}; chown ${osUser}:${osUser} ${quote(backupRoot)} ${quote(directory)}; exec ${runAs} ${osUser} sh -ceu ${quote(script)}`];
}

function dbBackupPlan(plan, backupId) {
    const backupRoot = `${plan.dataMount}/${plan.backupSubdirectory}`;
    const directory = `${backupRoot}/${backupId}`;
    return { directory, backupCommand: backupCommand({ ...plan, directory, backupRoot }) };
}

function validatePlan(plan, backupId, attempt) {
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 999) {
        throw new TypeError('Restore attempt must be 1 through 999');
    }
    if (!/^\d{8}-[a-z0-9][a-z0-9-]{0,29}$/u.test(backupId ?? '')) { throw new TypeError('Safe dated backup id required'); }
    for (const value of [plan.database, plan.restoreRole, plan.osUser]) {
        if (!/^[a-z_][a-z0-9_]*$/u.test(value ?? '')) { throw new TypeError('A simple database and operating system user are required'); }
    }
    if (!/^[a-z][a-z0-9-]*$/u.test(plan.runAs ?? '')) { throw new TypeError('A postgres user-switch command is required'); }
    if (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/u.test(plan.dataMount ?? '')
        || !/^[a-z0-9-]+$/u.test(plan.backupSubdirectory ?? '')) {
        throw new TypeError('PostgreSQL maintenance requires a data mount and backup subdirectory');
    }
}

/** Add a safe, immutable dated operation ID to a caller-selected database target. */
export default function postgresMaintenancePlan(plan, backupId, attempt = 1) {
    validatePlan(plan, backupId, attempt);
    const verificationName = `${plan.verificationNamePrefix}-${backupId}${attempt === 1 ? '' : `-r${attempt}`}`;
    const labels = { ...plan.restoreLabels, [plan.backupLabel]: backupId };
    return { ...plan, ...dbBackupPlan(plan, backupId), backupId, verificationName, labels };
}
