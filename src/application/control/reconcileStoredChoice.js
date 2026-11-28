/** Publish a choice only if its observed revision still matches, then use the stored value. */
export default async function reconcileStoredChoice({ key, read, choose, compareAndSet }) {
    const view = await read();
    const previous = view.assignments[key] ?? {};
    const next = choose(previous, view);
    if (JSON.stringify(next) === JSON.stringify(previous)) { return { record: previous, view }; }
    const committed = await compareAndSet(view.revisions[`assignments/${key}`], next);
    if (!committed) { return { record: previous, view }; }
    return { record: (await read()).assignments[key] ?? next, view };
}
