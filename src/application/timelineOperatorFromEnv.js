/**
 * Builds timelineOperator options from env and optional site config.
 *
 * @param {object} catalog - operator routes catalog with provider
 * @param {object} env - process environment
 * @param {object} config - siteServer config with optional anonymousUsers
 * @returns {object} timelineOperator options
 */
export default function timelineOperatorFromEnv(catalog, env, config) {
    const options = {
        provider: catalog.provider,
        requireOperator: env.REQUIRE_OPERATOR === 'true',
        defaultUser: env.HMI_OPERATOR_USER || 'hmi-kiosk'
    };
    if (config && config.anonymousUsers) {
        options.anonymousUsers = config.anonymousUsers;
    }
    return options;
}
