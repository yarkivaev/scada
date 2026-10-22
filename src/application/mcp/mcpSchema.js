/**
 * Column list for one schema table.
 *
 * @param {string} name - table name
 * @param {Array<object>} columns - name and type
 * @param {Array<string>} [notes] - short notes
 * @returns {object} table
 *
 * @example
 *   table('alerts', [{ name: 'id', type: 'integer' }]);
 */
function table(name, columns, notes) {
    if (!notes) {
        return { columns, name };
    }
    return { columns, name, notes };
}

/**
 * Postgres tables from scada migrations, without operator credentials.
 *
 * kind is an opaque string. Plant brigade tables are not listed.
 *
 * @returns {object} schema body
 *
 * @example
 *   postgresSchema().tables[0].name;
 */
export function postgresSchema() {
    return {
        tables: [
            table('segments', [
                { name: 'machine', type: 'text' },
                { name: 'name', type: 'text' },
                { name: 'start_time', type: 'timestamptz' },
                { name: 'end_time', type: 'timestamptz' },
                { name: 'duration', type: 'float' },
                { name: 'options', type: 'text' },
                { name: 'tags', type: 'text' },
                { name: 'properties', type: 'text' },
                { name: 'resolved', type: 'boolean' },
                { name: 'consumed', type: 'boolean' },
                { name: 'kind', type: 'text' },
                { name: 'updated_at', type: 'timestamptz' }
            ], ['kind is an opaque string']),
            table('operations', [
                { name: 'machine', type: 'text' },
                { name: 'occurred_at', type: 'timestamptz' },
                { name: 'kind', type: 'text' },
                { name: 'key', type: 'text' },
                { name: 'payload', type: 'jsonb' }
            ], ['kind is an opaque string']),
            table('alerts', [
                { name: 'id', type: 'integer' },
                { name: 'name', type: 'text' },
                { name: 'message', type: 'text' },
                { name: 'machine', type: 'text' },
                { name: 'severity', type: 'text' },
                { name: 'timestamp', type: 'timestamptz' },
                { name: 'acknowledged', type: 'boolean' }
            ]),
            table('user_decisions', [
                { name: 'machine', type: 'text' },
                { name: 'start_time', type: 'timestamptz' },
                { name: 'username', type: 'text' },
                { name: 'payload', type: 'text' },
                { name: 'operator_id', type: 'integer' },
                { name: 'decided_at', type: 'timestamptz' }
            ]),
            table('operators', [
                { name: 'id', type: 'integer' },
                { name: 'first_name', type: 'text' },
                { name: 'last_name', type: 'text' },
                { name: 'display_name', type: 'text' }
            ])
        ]
    };
}

/**
 * ClickHouse metrics table. topic is the only series key.
 *
 * @returns {object} schema body
 *
 * @example
 *   clickhouseSchema().tables[0].name;
 */
export function clickhouseSchema() {
    return {
        tables: [
            table('scada.metrics', [
                { name: 'topic', type: 'String' },
                { name: 'ts', type: 'DateTime64(3)' },
                { name: 'value', type: 'Float64' }
            ], ['topic is the only series key'])
        ]
    };
}
