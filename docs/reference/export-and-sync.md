[Documentation](../README.md) / [Reference](README.md)

# Export and site sync

Use export ports to move data to a downstream destination. Use site sync to pull data from an allowlisted site into local persistence.

Generic read/stream/write contract for outbound jobs. Read side uses existing `plantApi` / `@yarkivaev/scada/client` only (no direct DB). Destination adapters and plant maps live in plant packages, not here. Do not put export into `edgeApi`.

```javascript
import { exportQuery, exportStream, exportSink, exportJob } from '@yarkivaev/scada';
import { scadaClient } from '@yarkivaev/scada/client';

const client = scadaClient(baseUrl, fetch, EventSource);
const query = exportQuery(client);
const stream = exportStream(client);
const sink = exportSink({
  write(records) { return destination.write(records); },
  send(artifact) { return destination.send(artifact); }
});
const job = exportJob({ query, transform: (rows) => rows, sink });
await job.run({ kind: 'segments', machine: 'furnace-α', from, to });
```

`POST /api/v1/sync` on any `siteServer` pulls `segments` / `operations` / `measurements` / `alerts` from `SYNC_SITES` / `EDGE_SITES` / `CENTRAL_PLANT_URL`. Body: `{ site, from, to, machines?, kinds? }`. Optional `SYNC_TOKEN`. Does not republish to RabbitMQ.

```javascript
import { siteSync } from '@yarkivaev/scada';

await siteSync({ sites, queryFor, targets }).run({
  site: 'edge-icht-1',
  from,
  to,
  kinds: ['segments']
});
```

Alert and HMI copy are inject-only: pass `translations` into `siteServer` / `plantServer` / `alertPipeline` config, and override `TAG_CATALOG_PATH` or `plantApi({ tagCatalog })` for site taxonomy. Defaults ship empty or English stubs.

---

← [Analytics MCP](analytics-mcp.md) · [Central telemetry](central-telemetry.md) →
