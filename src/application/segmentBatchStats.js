/** Payload-free transaction counters for comparing configurations on the same image. */
export default function segmentBatchStats(intervalMs, output = line => { process.stdout.write(line); }, clock = () => { return performance.now(); }) {
    let started = clock();
    let totals = { commits: 0, rollbacks: 0, messages: 0, records: 0, sqlCalls: 0, maxTransactionMs: 0, maxWaitMs: 0 };
    return event => {
        if (intervalMs === 0) { return; }
        if (event.committed) {
            totals.commits += 1;totals.messages += event.messages;totals.records += event.records;totals.sqlCalls += event.sqlCalls;
            totals.maxTransactionMs = Math.max(totals.maxTransactionMs, event.durationMs);
            totals.maxWaitMs = Math.max(totals.maxWaitMs, event.waitMs);
        } else { totals.rollbacks += 1; }
        const now = clock();
        if (now - started >= intervalMs) {
            output(`[segment-transactions] ${JSON.stringify({ intervalMs: now - started, ...totals })}\n`);
            started = now;totals = { commits: 0, rollbacks: 0, messages: 0, records: 0, sqlCalls: 0, maxTransactionMs: 0, maxWaitMs: 0 };
        }
    };
}
