const DEFAULT_REGISTRY = 'registry.scada.svsokol.ru/infra/gitlab-ci-templates';

/**
 * Resolves a testcontainers image from the GitLab CI mirror registry.
 *
 * Override with TESTCONTAINERS_<NAME>_IMAGE where NAME is the mirror name
 * in upper case with hyphens as underscores (e.g. eclipse-mosquitto →
 * TESTCONTAINERS_ECLIPSE_MOSQUITTO_IMAGE).
 *
 * @param {string} name - mirror image name in infra/gitlab-ci-templates registry
 * @param {string} tag - image tag
 * @returns {string} full docker image reference
 *
 * @example
 *   new GenericContainer(ciContainerImage('eclipse-mosquitto', '2'));
 */
export default function ciContainerImage(name, tag) {
    const envKey = `TESTCONTAINERS_${name.replace(/-/gu, '_').toUpperCase()}_IMAGE`;
    const override = process.env[envKey];
    if (override) {
        return override;
    }
    const root = process.env.CI_CONTAINER_REGISTRY || DEFAULT_REGISTRY;
    return `${root}/${name}:${tag}`;
}
