[Documentation](../README.md) / [Architecture](README.md)

# Source layout

The repository separates domain logic, application wiring and infrastructure adapters.

## Repository layout

```
scada/
  src/
    domain/           business objects and ingest policies (no I/O)
    application/      composition roots (plantApi, supervisorSink, siteServer)
    infrastructure/   adapters (http, persistence, messaging, ingest, client)
    bin/              process entry points
  stream-processing/  Scala classification, replay and publication
  test/               mirrors src/ (domain/, infrastructure/, helpers/)
  db/migrations/      PostgreSQL schema (profile-specific prefixes)
  index.js            public API facade
```

## Layers

| Layer | Role | Examples |
|-------|------|----------|
| **domain/** | Pure business logic, no imports from infrastructure | `plant`, `shop`, `machine`, `timeline`, `alerts`, `segment/dispatch` |
| **application/** | Wires domain + infrastructure into runnable units | `plantApi`, `metricsPlant`, `supervisorSink`, `siteServer` |
| **infrastructure/** | I/O adapters behind narrow ports | `persistence/pg`, `http/plant`, `http/edge`, `messaging/stomp`, `ingest` |

Dependency rules:

- `domain/` imports `domain/` only
- `application/` composes `domain/` + `infrastructure/`
- HTTP routes receive injected `plant` objects; storage backends are swappable behind the same port shape

---

← [Package boundary](package-boundary.md) · [Data collection](../collect/README.md) →
