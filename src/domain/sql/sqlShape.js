/**
 * Collapses SQL literals so journals group by statement shape.
 *
 * Quoted strings and numbers become ?. Whitespace becomes a single space.
 *
 * @param {string} sql - original statement
 * @returns {string} shape
 *
 * @example
 *   sqlShape("SELECT value FROM metrics WHERE topic = 'α' AND ts >= 1");
 */
export default function sqlShape(sql) {
    const quotes = String(sql).replace(/'(?:''|[^'])*'/gu, '?');
    const numbers = quotes.replace(/\b\d+(?:\.\d+)?\b/gu, '?');
    return numbers.replace(/\s+/gu, ' ').trim();
}
