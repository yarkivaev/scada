# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Commands

```bash
npm test              # Run all tests with Mocha
npm test -- --grep "pattern"  # Run tests matching pattern
npm run coverage      # Run tests with coverage report
npm run lint          # Run ESLint
npm run lint:fix      # Run ESLint with auto-fix
npm run lint:eo       # Elegant Objects naming audit (no -er factories)
```

## CI/CD

GitHub repository `yarkivaev/scada`. PR CI: `npm-workflows` ci.yml (version check, lint including EO audit, test). Push to `main`: release.yml (re-check, tag `v*`, publish `@yarkivaev/scada` to npm).

## Layout

```
scada/
  src/
    domain/           business objects and ingest policies (no I/O)
    application/      composition roots (plantApi, supervisorSink)
    infrastructure/   adapters (http, persistence, messaging, ingest, client)
    bin/              thin process entry points
  test/               mirrors src/ (domain/, infrastructure/, helpers/)
  db/                 SQL migrations
  index.js            public API facade
```

## Three layers

| Layer | Contents |
|-------|----------|
| **domain/** | `plant`, `shop`, `machine`, `timeline`, `alerts`, `segment/dispatch`, `segment/normalize`, `alerting/ingest` |
| **application/** | `plantApi`, `machineInPlant`, `supervisorSink`, `shopWithTimeline`, `metricsPlant`, `plantServer`, `export/*` |
| **infrastructure/** | `http/plant`, `http/edge`, `persistence/pg`, `ingest`, `messaging/stomp`, `client` |

### Export ports

Generic `exportQuery` / `exportStream` / `exportSink` / `exportJob` compose on `plantApi` + `@yarkivaev/scada/client`. No plant destination names in this package; plant packages own sinks and jobs. Not part of `edgeApi`.

### Ingest sandwich

```
STOMP → infrastructure/ingest/codecs → domain/segment → infrastructure/ingest/sinks → PG
```

### Dependency rules

- `domain/` imports `domain/` only
- `application/` composes `domain/` + `infrastructure/`
- `infrastructure/http/plant/` uses injected `plant` objects (domain via DI)
- `persistence/pg/`, `persistence/memory/`, and `persistence/clickhouse/` mirror backend-specific state ports; compositors `stateDataFromPool` and `stateDataFromMemory` at the root

## Elegant Objects Principles

Constructors may not contain any code except assignment statements.
Implementation inheritance must be avoided at all costs (not to be confused with subtyping).
Getters must be avoided, as they are symptoms of an anemic object model.
