import { setTimeout as wait } from 'node:timers/promises';

export default async function openAfterCrash(queue) {
    const deadline = performance.now() + 1000;
    // SIGKILL reaps the collector before its SQLite child necessarily sees the IPC disconnect.
    for (;;) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await queue.open();
            return;
        } catch (error) {
            if (error.code !== 'SQLITE_BUSY' || performance.now() >= deadline) { throw error; }
            // eslint-disable-next-line no-await-in-loop
            await wait(10);
        }
    }
}
