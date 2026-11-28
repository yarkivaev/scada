/** Legacy metrics tables can supply epoch seconds, epoch milliseconds, or UTC text. */
export default function telemetryTimestamp(timestamp) {
    if (typeof timestamp === 'number') {
        return timestamp < 1e12 ? timestamp * 1000 : timestamp;
    }
    return Date.parse(`${String(timestamp).trim().replace(' ', 'T').replace(/Z$/u, '')}Z`);
}
