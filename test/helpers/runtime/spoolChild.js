import deliverySpool from '../../../src/infrastructure/persistence/runtime/deliverySpool.js';
const spool = deliverySpool(process.argv[2], { maxBytes:1000000 });
try {
    await spool.open();
    if (process.argv[3] === 'write') {
        await spool.append({eventId:'durable',body:Buffer.from('observation')},['one','two']);
        await spool.ack('durable','one');
        process.send('committed'); setInterval(() => {},1000);
    } else { process.send('owned'); await spool.close(); }
} catch (error) { process.send({error:error.message}); process.exitCode=1; }
