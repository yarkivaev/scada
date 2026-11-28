import pg from 'pg';

const protocol = ['postgres:', 'postgresql:'];

function addresses(adminUrl, runtimeUrl, { hosts, port = 5432, database, role }) {
    const admin = new URL(adminUrl);
    const runtime = new URL(runtimeUrl);
    for (const address of [admin, runtime]) {
        if (!protocol.includes(address.protocol) || !hosts.includes(address.hostname) ||
            (address.port || '5432') !== String(port) ||
            decodeURIComponent(address.pathname.slice(1)) !== database || !address.password) {
            throw new Error('Runtime role credentials must address the configured PostgreSQL database');
        }
    }
    if (decodeURIComponent(runtime.username) !== role) {
        throw new Error('Runtime login must use the configured restricted role');
    }
    return { admin, runtime };
}

async function activate(admin, runtime, roleName) {
    const result = await admin.query(
        'SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
        [roleName]
    );
    const role = result.rows[0];
    if (role && (role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls)) {
        throw new Error('Unexpected privileged runtime role');
    }
    if (role?.rolcanlogin) {
        return false;
    }
    if (!role) {
        const create = await admin.query("SELECT format('CREATE ROLE %I NOLOGIN', $1::text) AS command", [roleName]);
        await admin.query(create.rows[0].command);
    }
    const alter = await admin.query(
        "SELECT format('ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) AS command",
        [roleName, decodeURIComponent(runtime.password)]
    );
    await admin.query(alter.rows[0].command);
    return true;
}

/** Enables a restricted PostgreSQL login and verifies existing credentials without rotating its password. */
export default async function prepareRuntimeRole(adminUrl, runtimeUrl, settings) {
    const { role, verify, lockKey } = settings;
    const urls = addresses(adminUrl, runtimeUrl, settings);
    const admin = new pg.Client({ connectionString: urls.admin.href, connectionTimeoutMillis: 5000, 'query_timeout': 10000 });
    try {
        await admin.connect();
        await admin.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey ?? role]);
        const createdLogin = await activate(admin, urls.runtime, role);
        const application = new pg.Client({ connectionString: urls.runtime.href, connectionTimeoutMillis: 5000, 'query_timeout': 5000 });
        try {
            await application.connect();
            if (verify) {
                await verify(application);
            }
        } finally {
            await application.end();
        }
        return { user: role, createdLogin };
    } finally {
        await admin.end();
    }
}
