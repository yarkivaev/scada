import assert from 'assert';
import exportJob from '../../../src/application/export/exportJob.js';
import exportQuery from '../../../src/application/export/exportQuery.js';
import exportStream from '../../../src/application/export/exportStream.js';
import exportSink from '../../../src/application/export/exportSink.js';

describe('exportJob', function() {
    it('runs a segment query through transform into the sink', async function() {
        const tag = `tag-${Math.random().toString(36).slice(2)}`;
        const machineId = `furnace-${Math.random().toString(36).slice(2)}`;
        const written = [];
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    segments() {
                        return Promise.resolve({ items: [{ tags: [tag] }] });
                    }
                };
            }
        });
        const sink = exportSink({
            write(records) {
                written.push(...records);
                return Promise.resolve(records.length);
            },
            send() {
                return Promise.resolve();
            }
        });
        const job = exportJob({
            query,
            transform(body) {
                return body.items;
            },
            sink
        });
        await job.run({
            kind: 'segments',
            machine: machineId,
            from: '2026-02-01T00:00:00Z',
            to: '2026-02-02T00:00:00Z'
        });
        assert.strictEqual(written[0].tags[0], tag, 'exportJob did not write transformed query rows');
    });

    it('pipes stream events through transform into the sink', async function() {
        const payload = { name: `seg-${Math.random().toString(36).slice(2)}` };
        const written = [];
        const listeners = {};
        const stream = exportStream({
            machine() {
                return {
                    segmentStream() {
                        return {
                            on(event, notify) {
                                listeners[event] = notify;
                                return this;
                            },
                            close() {}
                        };
                    }
                };
            }
        });
        const sink = exportSink({
            write(records) {
                written.push(...records);
                return Promise.resolve(records.length);
            },
            send() {
                return Promise.resolve();
            }
        });
        const job = exportJob({
            stream,
            transform(rows) {
                return rows.map((row) => {
                    return { ...row, exported: true };
                });
            },
            sink
        });
        job.pipe({
            kind: 'segments',
            machine: `line-${Math.random().toString(36).slice(2)}`,
            events: ['segment_created']
        });
        await listeners.segment_created(payload);
        assert.strictEqual(written[0].exported, true, 'exportJob did not pipe stream events into the sink');
    });

    it('stops a piped stream subscription', function() {
        let closed = false;
        const stream = exportStream({
            machine() {
                return {
                    alertStream() {
                        return {
                            on() {
                                return this;
                            },
                            close() {
                                closed = true;
                            }
                        };
                    }
                };
            }
        });
        const job = exportJob({
            stream,
            sink: exportSink({
                write() {
                    return Promise.resolve(0);
                },
                send() {
                    return Promise.resolve();
                }
            })
        });
        const handle = job.pipe({
            kind: 'alerts',
            machine: `cell-${Math.random().toString(36).slice(2)}`
        });
        handle.stop();
        assert.strictEqual(closed, true, 'exportJob pipe handle did not close the stream');
    });

    it('runs a measurements query into the sink', async function() {
        const key = `U-${Math.random().toString(36).slice(2)}`;
        const written = [];
        const query = exportQuery({
            machines() {
                return Promise.resolve({ items: [] });
            },
            machine() {
                return {
                    measurements() {
                        return Promise.resolve({ items: [{ key }] });
                    }
                };
            }
        });
        const job = exportJob({
            query,
            transform(body) {
                return body.items;
            },
            sink: exportSink({
                write(records) {
                    written.push(...records);
                    return Promise.resolve(records.length);
                },
                send() {
                    return Promise.resolve();
                }
            })
        });
        await job.run({
            kind: 'measurements',
            machine: `m-${Math.random().toString(36).slice(2)}`,
            from: '2026-04-01T00:00:00Z',
            to: '2026-04-01T08:00:00Z',
            step: 60
        });
        assert.strictEqual(written[0].key, key, 'exportJob did not export measurement rows');
    });
});
