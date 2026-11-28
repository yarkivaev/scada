/** Skip kubectl apply when server-side diff reports the live objects already match. */
export default function applyWhenChanged(execute) {
    return (program, args, options) => {
        if (program !== 'kubectl' || !args.includes('apply') || args.includes('--dry-run=server')) {
            return execute(program, args, options);
        }
        try {
            execute(program, args.map((arg) => { return arg === 'apply' ? 'diff' : arg; }), options);
            return '';
        } catch (error) {
            if (error.status !== 1) { throw error; }
            return execute(program, args, options);
        }
    };
}
