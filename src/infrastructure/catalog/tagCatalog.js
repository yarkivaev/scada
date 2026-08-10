import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Loads hierarchical tag catalog entries from disk or embedded JSON.
 *
 * Prefers TAG_CATALOG_PATH when set so deploy ConfigMaps override the
 * package copy without rebuilding the image.
 *
 * @example
 *   const catalog = tagCatalog();
 *   catalog.labels().heating;
 *
 * @param {object} [env] - environment map, defaults to process.env
 * @returns {object} catalog with entries(), labels(), roots(parent)
 */
export default function tagCatalog(env) {
    const source = env || process.env;
    const path = source.TAG_CATALOG_PATH
        || join(dirname(fileURLToPath(import.meta.url)), 'tag-catalog.json');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(raw)) {
        throw new Error('tag catalog must be a JSON array');
    }
    const byId = Object.fromEntries(raw.map((row) => {
        return [row.id, row];
    }));
    return Object.freeze({
        /**
         * @returns {Array<object>} catalog rows
         */
        entries() {
            return raw.slice();
        },
        /**
         * @returns {object} id to label map
         */
        labels() {
            const map = {};
            raw.forEach((row) => {
                map[row.id] = row.label;
            });
            return map;
        },
        /**
         * @param {string} parent - parent id or segment name
         * @returns {Array<string>} child ids
         */
        children(parent) {
            return raw.filter((row) => {
                return row.parent === parent;
            }).map((row) => {
                return row.id;
            });
        },
        /**
         * @param {string} id - tag id
         * @returns {object|undefined} catalog row
         */
        get(id) {
            return byId[id];
        }
    });
}
