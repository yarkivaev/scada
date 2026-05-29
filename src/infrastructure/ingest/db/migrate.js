import fs from 'fs/promises';
import path from 'path';
import { migrationApplies, migrationSinkRunnable } from './migrationProfile.js';
/* eslint-disable no-await-in-loop */

function migrationSelected(name, profile, privileged) {
    if (!name.endsWith('.sql') || !migrationApplies(name, profile)) {
        return false;
    }
    const sinkRunnable = migrationSinkRunnable(name);
    return privileged ? !sinkRunnable : sinkRunnable;
}

async function ensureMigrationsTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

async function applyMigrationFiles(pool, migrationsDir, profile, privileged) {
    const files = (await fs.readdir(migrationsDir))
        .filter((name) => {
            return migrationSelected(name, profile, privileged);
        })
        .sort((left, right) => {
            return left.localeCompare(right);
        });
    for (const file of files) {
        const { rowCount } = await pool.query(
            'SELECT 1 FROM schema_migrations WHERE version = $1',
            [file]
        );
        if (rowCount === 0) {
            const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
            await pool.query('BEGIN');
            try {
                await pool.query(sql);
                await pool.query(
                    'INSERT INTO schema_migrations (version) VALUES ($1)',
                    [file]
                );
                await pool.query('COMMIT');
            } catch (error) {
                await pool.query('ROLLBACK');
                throw error;
            }
        }
    }
}

/**
 * Applies SQL migrations runnable as supervisor_sink.
 *
 * @param {object} pool - pg.Pool instance.
 * @param {string} migrationsDir - absolute path to migration files.
 * @param {string} [profile] - central or edge; filters E/C prefixed files
 * @returns {Promise<void>}
 */
export default async function migrate(pool, migrationsDir, profile = 'edge') {
    await ensureMigrationsTable(pool);
    await applyMigrationFiles(pool, migrationsDir, profile, false);
}

/**
 * Applies privilege migrations that require Postgres superuser (scada).
 *
 * @param {object} pool - pg.Pool connected as scada or other superuser.
 * @param {string} migrationsDir - absolute path to migration files.
 * @param {string} [profile] - central or edge; filters E/C prefixed files
 * @returns {Promise<void>}
 */
export async function migratePrivileged(pool, migrationsDir, profile = 'central') {
    await ensureMigrationsTable(pool);
    await applyMigrationFiles(pool, migrationsDir, profile, true);
}
