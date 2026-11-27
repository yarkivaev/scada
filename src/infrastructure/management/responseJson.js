/** Bound monitoring response memory, including chunked or compressed bodies. */
export default async function responseJson(response, maxBytes) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
            throw new Error('monitoring response is too large');
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
