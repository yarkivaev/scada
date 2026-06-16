import operator from '../../../domain/operator/operator.js';

/**
 * PostgreSQL operators read port for central site-server.
 * Implements the operators provider port: list().
 *
 * @param {object} pool - pg pool
 * @returns {object} provider with async list()
 *
 * @example
 *   const provider = operatorsFromPg(pool);
 *   const rows = await provider.list();
 */
export default function operatorsFromPg(pool) {
    return {
        async list() {
            const result = await pool.query(
                'SELECT id, card_uid, first_name, last_name, display_name FROM operators ORDER BY id'
            );
            return result.rows.map((row) => {
                return operator(row.id, row.card_uid, row.first_name, row.last_name, row.display_name);
            });
        }
    };
}
