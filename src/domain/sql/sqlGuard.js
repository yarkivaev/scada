/**
 * Requires SQL text.
 *
 * @param {string} sql - statement
 * @param {string} engine - clickhouse or postgres
 * @returns {string} sql
 *
 * @example
 *   textOf('SELECT 1', 'postgres');
 */
function textOf(sql, engine) {
    if (typeof sql === 'string') {
        return sql;
    }
    throw new Error(`SQL text is missing for ${engine}`);
}

/**
 * Strips comments and masks string literals so keyword checks see code.
 *
 * @param {string} sql - raw statement
 * @returns {string} masked statement
 *
 * @example
 *   mask("SELECT 'drop'");
 */
function mask(sql) {
    const comments = sql.replace(/\/\*[\s\S]*?\*\//gu, ' ');
    const lines = comments.replace(/--[^\n]*/gu, ' ');
    return lines.replace(/'(?:''|[^'])*'/gu, '?');
}

/**
 * Keeps a single statement and rejects empties and batches.
 *
 * @param {string} masked - masked SQL
 * @param {string} engine - engine name
 * @returns {string} trimmed statement
 *
 * @example
 *   one('SELECT 1', 'postgres');
 */
function one(masked, engine) {
    const trimmed = masked.trim().replace(/;+\s*$/u, '').trim();
    if (trimmed.includes(';')) {
        throw new Error(`SQL has more than one statement for ${engine}`);
    }
    if (trimmed.length === 0) {
        throw new Error(`SQL is empty for ${engine}`);
    }
    return trimmed;
}

/**
 * Shortens SQL for an error without adding a sentence period.
 *
 * @param {string} body - statement
 * @returns {string} single-line preview
 *
 * @example
 *   preview('SELECT 1');
 */
function preview(body) {
    const flat = body.replace(/\s+/gu, ' ').trim();
    if (flat.length > 120) {
        return flat.slice(0, 120);
    }
    return flat;
}

/**
 * Allows only SELECT and WITH.
 *
 * @param {string} body - one statement
 * @param {string} engine - engine name
 * @returns {void}
 *
 * @example
 *   assertRead('SELECT 1', 'postgres');
 */
function assertRead(body, engine) {
    if (/^(?:select|with)\b/iu.test(body)) {
        return;
    }
    throw new Error(`SQL is not a read for ${engine}: ${preview(body)}`);
}

/**
 * Rejects write and admin keywords.
 *
 * @param {string} body - masked statement
 * @param {string} engine - engine name
 * @returns {void}
 *
 * @example
 *   assertWords('SELECT 1', 'postgres');
 */
function assertWords(body, engine) {
    const found = /\b(?<word>alter|copy|delete|drop|grant|insert|system|truncate|update)\b/iu.exec(body);
    if (found) {
        throw new Error(`SQL contains ${found.groups.word.toLowerCase()} for ${engine}`);
    }
}

/**
 * Rejects the operator credential column.
 *
 * @param {string} body - masked statement
 * @param {string} engine - engine name
 * @returns {void}
 *
 * @example
 *   assertUid('SELECT name FROM operators', 'postgres');
 */
function assertUid(body, engine) {
    if (/\bcard_uid\b/iu.test(body)) {
        throw new Error(`SQL references card_uid for ${engine}`);
    }
}

/**
 * Requires a ts comparison on ClickHouse.
 *
 * @param {string} body - masked statement
 * @param {string} engine - engine name
 * @returns {void}
 *
 * @example
 *   assertTs('SELECT value FROM metrics WHERE ts >= 1', 'clickhouse');
 */
function assertTs(body, engine) {
    if (engine !== 'clickhouse') {
        return;
    }
    if (/\bts\s*(?:>=|<=|<>|!=|>|<|=|between\b|in\b)/iu.test(body)) {
        return;
    }
    throw new Error(`ClickHouse SQL lacks a ts predicate: ${preview(body)}`);
}

/**
 * Trims one trailing semicolon from the original text.
 *
 * @param {string} sql - original statement
 * @returns {string} statement to execute
 *
 * @example
 *   executable('SELECT 1;');
 */
function executable(sql) {
    return sql.trim().replace(/;+\s*$/u, '').trim();
}

/**
 * Rejects analytics SQL that is not one read-only statement.
 *
 * SELECT and WITH are allowed. Writes, card_uid, and extra statements are
 * rejected before a driver sees them. ClickHouse also needs a ts predicate.
 *
 * @param {string} sql - one statement
 * @param {string} engine - clickhouse or postgres
 * @returns {string} trimmed statement safe to execute
 *
 * @example
 *   sqlGuard("SELECT value FROM metrics WHERE ts >= '2024-11-02'", 'clickhouse');
 */
export default function sqlGuard(sql, engine) {
    const text = textOf(sql, engine);
    const body = one(mask(text), engine);
    assertRead(body, engine);
    assertWords(body, engine);
    assertUid(body, engine);
    assertTs(body, engine);
    return executable(text);
}
