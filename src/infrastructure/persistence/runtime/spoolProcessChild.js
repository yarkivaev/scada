import deliverySpool from './deliverySpool.js';

const [, , directory, options] = process.argv;
const spool = deliverySpool(directory, JSON.parse(options));

function errorDetails({ name, message, code }) {
    return { name, message, code };
}

async function run({ method, args }) {
    try {
        const result = await spool[method](...args);
        const value = method === 'mutateMany'
            ? result.map(item => { return item.ok ? item : { ...item, error: errorDetails(item.error) }; })
            : result;
        return { value };
    } catch (error) {
        return { error: errorDetails(error) };
    }
}

async function receive(message) {
    const response = await run(message);
    if (process.connected) {
        process.send({ ...response, status: spool.status() }, error => {
            if (error && process.connected) { process.disconnect(); }
        });
    }
}

process.on('message', receive);
process.once('disconnect', () => { process.off('message', receive); });
