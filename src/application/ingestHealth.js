/** Process health follows all owned readers, not merely the HTTP listener. */
export default function ingestHealth({ onFatal } = {}) {
    const state = { sources: [], started: false, fatal: null };
    return {
        track(sources) { state.sources = sources; },
        started() { state.started = true; },
        fail(error) {
            if (state.fatal) { return; }
            state.fatal = error;
            onFatal?.(error);
        },
        status() {
            return { live: !state.fatal, ready: state.started && !state.fatal
                && state.sources.every((source) => {return source.health().state === 'running'}) };
        }
    };
}
