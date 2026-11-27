[Documentation](../README.md) / [Reference](README.md)

# Analytics MCP

Run the stateless Streamable HTTP MCP server with the plant namespace, catalog and read ports.

`analyticsMcp` is a stateless Streamable HTTP MCP server. The plant package supplies a `namespaceTree` (path, kind, silence, source topic), read ports, and the tag catalog already used by `plantApi({ tagCatalog })`. Tools address nodes by path. `query_postgres` is registered only when a standby query port is supplied. Each SQL engine runs one query at a time. Each call writes one JSON line to the injected journal. `GET /metrics` exposes call counts and in-flight reads.

Resources: `plant://topology`, `plant://bindings`, `plant://tags`, `plant://schema/postgres`, `plant://schema/clickhouse`. Column lists live in the schema resources, not here.

```javascript
import { analyticsMcp, namespaceTree, tagCatalog } from '@yarkivaev/scada';

const mcp = analyticsMcp({
  tree: namespaceTree(nodes),
  catalog: tagCatalog(),
  tokens: { secret: 'analyst' },
  journal(line) { process.stdout.write(line); },
  ports: {
    measurements, segments, operations, alerts, state, samples, cursor, queryClickhouse
  },
  extend(server) { /* plant tools, resources, prompts */ }
});
await mcp.listen(0, '127.0.0.1');
```

`ports.queryPostgres` registers `query_postgres`. `extend(server)` may add plant tools. `POST /mcp` requires `Authorization: Bearer`. Coverage spans add the overlapping timeline segment name as `phase`. The process journal is stdout only; `activityTracking` still writes Loki HTTP access into `activity.http_access`, not `activity.mcp_calls`.

---

← [JavaScript API](javascript-api.md) · [Export and site sync](export-and-sync.md) →
