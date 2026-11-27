[Documentation](README.md)

# Contributing

Develop and verify SCADA changes in the repository. Follow the [testing and release policy](../AGENTS.md) before pushing or releasing.

## Testing

```bash
npm test                        # all Mocha unit tests
npm test -- --grep "pattern"    # filter by name
npm run test:deep               # domain + ingest (integration needs Docker)
npm run coverage
npm run lint
npm run lint:eo                 # Elegant Objects naming audit
```

Tests mirror `src/` under `test/`. Use fakes instead of mocks; one assertion per test. Integration tests under `test/infrastructure/**/integration/` use testcontainers.

For HTTP/state tests without PostgreSQL:

```javascript
import stateDataFake from '@yarkivaev/scada/stateDataFake';
```

## Scala Supervisor checks

Run `sbt test assembly` from `supervisor-engine/` with JDK 21. The release workflow runs these checks on `main` before tagging and publishing. Verify profile-specific behavior in each consuming plant repository.

## Design conventions

- Factory functions returning frozen objects — no classes, no inheritance
- ESLint limits: `max-lines: 200`, `max-lines-per-function: 50`, `no-console`, `no-inline-comments`
- Docblocks on every module; method bodies without blank lines
- See [CLAUDE.md](../CLAUDE.md) for layer rules and the ingest pipeline diagram

## CI and releases

The [release workflow](../.github/workflows/release.yml) runs the version check, lint, Node.js tests, control integration and Scala Supervisor tests and assembly on `main`. Tagging and npm publication require the relevant checks to pass. Downstream deployment repositories build plant container images.

## Measurements

- [SQLite delivery spool capacity](measurements/2026-11-11-delivery-spool.md)
- [Bounded group-commit measurement](measurements/2026-11-11-group-commit.md)

---

← [Timeline persistence](reference/timeline-persistence.md)
