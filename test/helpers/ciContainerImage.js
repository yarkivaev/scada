const PUBLIC_HUB_IMAGES = {
    postgres: (tag) => {
        return `postgres:${tag}`;
    },
    'rabbitmq-management-alpine': (tag) => {
        return `rabbitmq:${tag}-management-alpine`;
    },
    'clickhouse-server': (tag) => {
        return `clickhouse/clickhouse-server:${tag}`;
    },
    'eclipse-mosquitto': (tag) => {
        return `eclipse-mosquitto:${tag}`;
    },
    loki: (tag) => {
        return `grafana/loki:${tag}`;
    }
};

/**
 * Resolves a testcontainers image for local Docker Hub or CI mirror registry.
 *
 * Priority: TESTCONTAINERS_<NAME>_IMAGE env, then CI_CONTAINER_REGISTRY mirror,
 * then public Docker Hub equivalents for known mirrors.
 *
 * Override with TESTCONTAINERS_<NAME>_IMAGE where NAME is the mirror name
 * in upper case with hyphens as underscores (e.g. eclipse-mosquitto →
 * TESTCONTAINERS_ECLIPSE_MOSQUITTO_IMAGE).
 *
 * @param {string} name - mirror image short name (e.g. eclipse-mosquitto)
 * @param {string} tag - image tag
 * @param {NodeJS.ProcessEnv} env - environment variables
 * @returns {string} full docker image reference
 *
 * @example
 *   new GenericContainer(resolveCiContainerImage('eclipse-mosquitto', '2'));
 */
export function resolveCiContainerImage(name, tag, env = process.env) {
    const envKey = `TESTCONTAINERS_${name.replace(/-/gu, '_').toUpperCase()}_IMAGE`;
    const override = env[envKey];
    if (override) {
        return override;
    }
    const root = env.CI_CONTAINER_REGISTRY;
    if (root) {
        return `${root}/${name}:${tag}`;
    }
    const hub = PUBLIC_HUB_IMAGES[name];
    if (hub) {
        return hub(tag);
    }
    throw new Error(`unknown testcontainers mirror ${name}:${tag} without CI_CONTAINER_REGISTRY`);
}

/**
 * Resolves a testcontainers image using process.env.
 *
 * @param {string} name - mirror image short name (e.g. eclipse-mosquitto)
 * @param {string} tag - image tag
 * @returns {string} full docker image reference
 *
 * @example
 *   new GenericContainer(ciContainerImage('eclipse-mosquitto', '2'));
 */
export default function ciContainerImage(name, tag) {
    return resolveCiContainerImage(name, tag, process.env);
}
