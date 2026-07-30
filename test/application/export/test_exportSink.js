import assert from 'assert';
import exportSink from '../../../src/application/export/exportSink.js';

describe('exportSink', function() {
    it('writes record batches to the destination', async function() {
        const token = `row-${Math.random().toString(36).slice(2)}`;
        const written = [];
        const sink = exportSink({
            write(records) {
                written.push(...records);
                return Promise.resolve(records.length);
            },
            send() {
                return Promise.resolve();
            }
        });
        await sink.write([{ id: token }]);
        assert.strictEqual(written[0].id, token, 'exportSink did not write records to the destination');
    });

    it('sends a single artifact to the destination', async function() {
        const name = `artifact-${Math.random().toString(36).slice(2)}.bin`;
        let sent;
        const sink = exportSink({
            write() {
                return Promise.resolve(0);
            },
            send(artifact) {
                sent = artifact;
                return Promise.resolve(true);
            }
        });
        await sink.send({ name, bytes: Buffer.from(name) });
        assert.strictEqual(sent.name, name, 'exportSink did not send the artifact to the destination');
    });
});
