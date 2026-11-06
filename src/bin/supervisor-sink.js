/** Supervisor-sink process; a fenced reader must not leave a healthy zombie HTTP server. */
import runSupervisorSink from '../application/runSupervisorSink.js';

process.on('unhandledRejection', (error) => {
    process.stderr.write(`Unhandled rejection: ${String(error)}\n`);
    process.exit(1);
});

runSupervisorSink(process.env).catch((error) => {
    process.stderr.write(`Supervisor sink failed: ${String(error)}\n`);
    process.exit(1);
});
