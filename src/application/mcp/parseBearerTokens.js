/**
 * Reads a JSON bearer-to-name map when the env value is an object.
 *
 * @param {string} raw - ANALYTICS_MCP_TOKEN value
 * @returns {object|undefined} map or undefined when the value is a single token
 *
 * @example
 *   parsedMap('{"secret":"analyst"}').analyst;
 */
function parsedMap(raw) {
    if (!raw.startsWith('{')) {
        return undefined;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
    }
    return undefined;
}

/**
 * Builds the analyticsMcp bearer map from ANALYTICS_MCP_TOKEN.
 *
 * A JSON object is bearer → caller name. A single token becomes one named
 * caller `agent`.
 *
 * @param {string} raw - environment value
 * @returns {object} token to caller name
 *
 * @example
 *   mcpTokens('fixture-token')['fixture-token'];
 */
export default function mcpTokens(raw) {
    if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('ANALYTICS_MCP_TOKEN is missing');
    }
    const trimmed = raw.trim();
    const mapped = parsedMap(trimmed);
    if (mapped) {
        return mapped;
    }
    return { [trimmed]: 'agent' };
}
