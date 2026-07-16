import operator from '../../../domain/operator/operator.js';

function conflict(uid) {
    const err = new Error(`operator cardUid '${uid}' already exists`);
    err.routeCode = 'CONFLICT';
    err.routeStatus = 409;
    return err;
}

function logFailure(logger, message, err) {
    if (logger && typeof logger.error === 'function') {
        logger.error(message, err);
        return;
    }
    console.error(message, err); // eslint-disable-line no-console
}

async function listRows(pool, logger) {
    try {
        const result = await pool.query(
            'SELECT id, card_uid, first_name, last_name, display_name FROM operators ORDER BY id'
        );
        return result.rows.map((row) => {
            return operator(row.id, row.card_uid, row.first_name, row.last_name, row.display_name);
        });
    } catch (err) {
        const message = `operatorsFromPg list failed: ${err && err.message ? err.message : 'unknown error'}`;
        logFailure(logger, message, err);
        throw err;
    }
}

async function insertRow(pool, logger, fields) {
    try {
        const result = await pool.query(
            `INSERT INTO operators (card_uid, first_name, last_name, display_name)
             VALUES ($1, $2, $3, $4)
             RETURNING id, card_uid, first_name, last_name, display_name`,
            [fields.cardUid, fields.firstName, fields.lastName, fields.displayName]
        );
        const row = result.rows[0];
        return operator(row.id, row.card_uid, row.first_name, row.last_name, row.display_name);
    } catch (err) {
        if (err && err.code === '23505') {
            throw conflict(fields.cardUid);
        }
        const message = `operatorsFromPg create failed: ${err && err.message ? err.message : 'unknown error'}`;
        logFailure(logger, message, err);
        throw err;
    }
}

async function readFlag(pool, logger) {
    try {
        const result = await pool.query(
            'SELECT enabled FROM operators_registration WHERE singleton = 1'
        );
        if (!result.rows.length) {
            throw new Error('operators_registration singleton row missing');
        }
        return result.rows[0].enabled === true;
    } catch (err) {
        const message = `operatorsFromPg enabled failed: ${err && err.message ? err.message : 'unknown error'}`;
        logFailure(logger, message, err);
        throw err;
    }
}

async function writeFlag(pool, logger, flag) {
    try {
        const result = await pool.query(
            `UPDATE operators_registration SET enabled = $1 WHERE singleton = 1
             RETURNING enabled`,
            [flag === true]
        );
        if (!result.rows.length) {
            throw new Error('operators_registration singleton row missing');
        }
        return result.rows[0].enabled === true;
    } catch (err) {
        const message = `operatorsFromPg permit failed: ${err && err.message ? err.message : 'unknown error'}`;
        logFailure(logger, message, err);
        throw err;
    }
}

/**
 * PostgreSQL operators port for central site-server.
 * Implements list(), create(fields), enabled(), and permit(flag).
 *
 * @param {object} pool - pg pool
 * @param {object} [logger] - optional logger with error(message, err)
 * @returns {object} provider with async list, create, enabled, permit
 *
 * @example
 *   const provider = operatorsFromPg(pool);
 *   const rows = await provider.list();
 *   const created = await provider.create({
 *     cardUid: 'AB12', firstName: 'Иван', lastName: 'Петров', displayName: 'Иван Петров'
 *   });
 *   await provider.permit(true);
 */
export default function operatorsFromPg(pool, logger) {
    return {
        list() {
            return listRows(pool, logger);
        },
        create(fields) {
            return insertRow(pool, logger, fields);
        },
        enabled() {
            return readFlag(pool, logger);
        },
        permit(flag) {
            return writeFlag(pool, logger, flag);
        }
    };
}
