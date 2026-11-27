[Documentation](../README.md) / [Reference](README.md)

# Export and site sync

Use export ports to move data to a downstream destination. Use site sync to pull data from an allowlisted site into local persistence.

The read side uses `plantApi` through `@yarkivaev/scada/client`. Supply the API base URL, date range, and destination adapter. Supply an EventSource implementation for live subscriptions in environments without a built-in one.

```javascript
import { exportQuery, exportStream, exportSink, exportJob } from '@yarkivaev/scada';
import { scadaClient } from '@yarkivaev/scada/client';

const client = scadaClient(baseUrl, fetch, EventSource);
const query = exportQuery(client);
const stream = exportStream(client); // Pass to exportJob for live subscriptions.
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
