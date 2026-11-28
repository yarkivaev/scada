import assert from 'assert';
import scramble from '../../../../src/infrastructure/ingest/mysql40/scramble.js';

describe('MySQL 4.0 scramble', function() {
    it('matches the MySQL 4.0 old password scramble', function() {
        const salt = Buffer.from([0x28, 0x57, 0x5e, 0x55, 0x6c, 0x43, 0x46, 0x75]);
        const password = Buffer.from('fictional');
        assert.strictEqual(
            scramble(salt, password).toString('hex'),
            '4b4e53475f485958',
            'old-password scramble did not match the MySQL 4.0 fixture'
        );
    });
});
