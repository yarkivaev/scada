/** A longer fresh bucket is the same claim. A new token, cursor, or earlier start is not. */
export default function claimConflict(work, base) {
    const cursor = work.cursor_ms === null ? null : Number(work.cursor_ms);
    const end = work.end_ms === null ? null : Number(work.end_ms);
    const token = String(work.token) !== base?.workToken;
    const from = Number(work.from_ms) < Number(base.from);
    const moved = cursor !== (base.cursor ?? null) || end !== (base.end ?? null);
    return token || from || moved;
}
