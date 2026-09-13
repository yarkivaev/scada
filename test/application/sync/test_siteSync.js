import assert from 'assert';
import siteSync from '../../../src/application/sync/siteSync.js';

function fakeQuery(store) {
    return {
        machines() {
            return Promise.resolve({ items: store.machines });
        },
        segments(machine, range) {
            return Promise.resolve({ items: store.segments.filter((row) => {
                return row.machine === machine && row.start >= range.from && row.start <= range.to;
            }) });
        },
        operations(machine) {
            return Promise.resolve({ items: store.operations.filter((row) => {
                return row.machine === machine;
            }) });
        },
        measurements() {
            return Promise.resolve({ items: [] });
        },
        alerts() {
            return Promise.resolve({ items: [] });
        }
    };
}

describe('siteSync', function() {
    it('writes only requested kinds and machines in the window', async function() {
        const token = `\u00e9${Math.random().toString(36).slice(2)}`;
        const written = [];
        const store = {
            machines: [{ id: 'icht1' }, { id: 'icht2' }],
            segments: [
                { machine: 'icht1', name: token, start: '2026-09-11T00:00:00.000Z' },
                { machine: 'icht1', name: 'skip', start: '2026-09-01T00:00:00.000Z' },
                { machine: 'icht2', name: 'other', start: '2026-09-11T00:00:00.000Z' }
            ],
            operations: [{ machine: 'icht1', external_key: token }]
        };
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1', machines: ['icht1'] }],
            queryFor() {
                return fakeQuery(store);
            },
            targets: {
                segments: {
                    write(machine, body) {
                        written.push({ kind: 'segments', machine, items: body.items });
                        return Promise.resolve(body.items.length);
                    }
                },
                operations: {
                    write() {
                        return Promise.resolve(0);
                    }
                }
            }
        });
        const result = await sync.run({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z',
            machines: ['icht1'],
            kinds: ['segments']
        });
        assert.strictEqual(
            result.counts.segments === 1 && written[0].items[0].name === token,
            true,
            'siteSync did not write the in-window segment for the requested machine'
        );
    });

    it('rejects an unknown site', async function() {
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return fakeQuery({ machines: [], segments: [], operations: [] });
            },
            targets: {
                segments: {
                    write() {
                        return Promise.resolve(0);
                    }
                }
            }
        });
        let rejected = false;
        try {
            await sync.run({
                site: `ghost-${Math.random().toString(36).slice(2)}`,
                from: '2026-09-10T00:00:00.000Z',
                to: '2026-09-12T00:00:00.000Z'
            });
        } catch {
            rejected = true;
        }
        assert.strictEqual(rejected, true, 'siteSync accepted a site outside the allowlist');
    });

    it('rejects an unknown kind', async function() {
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return fakeQuery({ machines: [], segments: [], operations: [] });
            },
            targets: {
                segments: {
                    write() {
                        return Promise.resolve(0);
                    }
                }
            }
        });
        let rejected = false;
        try {
            await sync.run({
                site: 'edge-icht-1',
                from: '2026-09-10T00:00:00.000Z',
                to: '2026-09-12T00:00:00.000Z',
                kinds: ['cycles']
            });
        } catch {
            rejected = true;
        }
        assert.strictEqual(rejected, true, 'siteSync accepted a kind without a local target');
    });

    it('does not forward sync kinds as a remote timeline filter', async function() {
        let range;
        const from = '2026-09-10T00:00:00.000Z';
        const to = '2026-09-12T00:00:00.000Z';
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return {
                    machines() {
                        return Promise.resolve({ items: [{ id: 'icht1' }] });
                    },
                    segments(machine, query) {
                        range = query;
                        return Promise.resolve({ items: [] });
                    },
                    operations() {
                        return Promise.resolve({ items: [] });
                    },
                    measurements() {
                        return Promise.resolve({ items: [] });
                    },
                    alerts() {
                        return Promise.resolve({ items: [] });
                    }
                };
            },
            targets: {
                segments: {
                    write() {
                        return Promise.resolve(0);
                    }
                }
            }
        });
        await sync.run({
            site: 'edge-icht-1',
            from,
            to,
            machines: ['icht1'],
            kinds: ['segments']
        });
        assert.deepStrictEqual(
            range,
            { from, to },
            'siteSync forwarded sync kinds into the remote timeline filter'
        );
    });

    it('leaves a local segment that the remote window does not mention', async function() {
        const leftover = `keep-\u00e9${Math.random().toString(36).slice(2)}`;
        const local = [{ name: leftover }];
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return fakeQuery({ machines: [{ id: 'icht1' }], segments: [], operations: [] });
            },
            targets: {
                segments: {
                    write(machine, body) {
                        body.items.forEach((item) => {
                            local.push(item);
                        });
                        return Promise.resolve(body.items.length);
                    },
                    remove() {
                        local.length = 0;
                    }
                }
            }
        });
        await sync.run({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z',
            machines: ['icht1'],
            kinds: ['segments']
        });
        assert.strictEqual(
            local.some((row) => {
                return row.name === leftover;
            }) && local.length === 1,
            true,
            'siteSync deleted a local segment the remote did not send'
        );
    });

    it('reports after each machine kind write', async function() {
        const seen = [];
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return fakeQuery({
                    machines: [{ id: 'icht1' }],
                    segments: [{ machine: 'icht1', name: 'on', start: '2026-09-11T00:00:00.000Z' }],
                    operations: []
                });
            },
            targets: {
                segments: {
                    write(machine, body) {
                        return Promise.resolve(body.items.length);
                    }
                }
            }
        });
        await sync.run({
            site: 'edge-icht-1',
            from: '2026-09-10T00:00:00.000Z',
            to: '2026-09-12T00:00:00.000Z',
            machines: ['icht1'],
            kinds: ['segments']
        }, {
            report(progress) {
                seen.push(progress);
            }
        });
        assert.strictEqual(
            seen.length === 1 && seen[0].kind === 'segments' && seen[0].machine === 'icht1',
            true,
            'siteSync did not report after a kind write'
        );
    });

    it('stops when the signal is aborted', async function() {
        const controller = new AbortController();
        controller.abort();
        const sync = siteSync({
            sites: [{ id: 'edge-icht-1', url: 'http://edge/api/v1' }],
            queryFor() {
                return fakeQuery({ machines: [{ id: 'icht1' }], segments: [], operations: [] });
            },
            targets: {
                segments: {
                    write() {
                        return Promise.resolve(0);
                    }
                }
            }
        });
        let stopped = false;
        try {
            await sync.run({
                site: 'edge-icht-1',
                from: '2026-09-10T00:00:00.000Z',
                to: '2026-09-12T00:00:00.000Z',
                machines: ['icht1'],
                kinds: ['segments']
            }, { signal: controller.signal });
        } catch {
            stopped = true;
        }
        assert.strictEqual(stopped, true, 'siteSync ignored an aborted signal');
    });
});
