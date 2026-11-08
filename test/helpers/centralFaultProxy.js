import http from 'node:http';

/** Hold a real INSERT either before commit or after commit before its reply. */
export default async function centralFaultProxy(backend,beforeCommit=false) {
    let notify;
    let failed;
    let forwardDone;
    let forwardFailed;
    let release;
    let first=true;
    const blocked=new Promise((resolve,reject) => {notify=resolve;failed=reject;});
    const forwarded=new Promise((resolve,reject) => {forwardDone=resolve;forwardFailed=reject;});
    void blocked.catch(() => {return undefined;});
    void forwarded.catch(() => {return undefined;});
    const withheld=new Promise((resolve) => {release=resolve;});
    async function handle(request,response) {
        const chunks=[];
        for await(const chunk of request) {chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        const query=new URL(request.url,backend).searchParams.get('query')||body.toString();
        const held=first&&query.trim().startsWith('INSERT INTO scada.metrics_compact_v2');
        if(held){first=false;if(beforeCommit){notify();await withheld;}}
        const upstream=await fetch(new URL(request.url,backend),{method:request.method,
            headers:{'content-type':request.headers['content-type']||'text/plain',...(request.headers.authorization?{authorization:request.headers.authorization}:{})},
            ...(body.length?{body}:{} )});
        const result=await upstream.text();
        if(held) {
            if(!upstream.ok){throw new Error(result);}
            forwardDone();if(!beforeCommit){notify();}await withheld;response.destroy();return;
        }
        response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'text/plain'});
        response.end(result);
    }
    const server=http.createServer((request,response) => {
        void handle(request,response).catch((error) => {failed(error);forwardFailed(error);response.destroy(error);});
    });
    await new Promise((resolve) => {server.listen(0,'127.0.0.1',resolve);});
    return {url:`http://127.0.0.1:${server.address().port}`,blocked,forwarded,release,
        async stop() {release();server.closeAllConnections();await new Promise((resolve) => {server.close(resolve);});}};
}
