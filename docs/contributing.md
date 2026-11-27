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

## Management CLI smoke tests

Run these from the repository root after `npm ci`, with Node.js 22, OpenSSL
and a local Docker daemon that can run privileged test containers. The k3s test
also requires `kubectl` in the same minor version range as the test cluster and
Helm 3. The systemd test requires private cgroup v2 support and downloads Debian
packages during its test image build.

```bash
npx mocha --exit test/bin/test_management.js
bash test/smoke/management-k3s.sh
bash test/smoke/management-systemd.sh
```

The k3s test installs the npm tarball in a temporary directory, starts the
gateway with TLS, and checks Helm and server-side apply against a fresh cluster.
The systemd test uses two HTTPS gateways to start a real service and read its
journal in a separate Linux container. Both check read-only access and retry,
use only loopback ports or container-private addresses, and remove the test
containers at exit. The k3s test uses only the kubeconfig it generates from its
own container.

## Scala stream processing checks

From `stream-processing/` with JDK 21, run `./resolve-dependencies.sh` followed by `sbt test assembly`. The release workflow runs these checks on `main` before tagging and publishing. Verify profile-specific behavior in each consuming plant repository.

## Design conventions

- Factory functions returning frozen objects — no classes, no inheritance
- ESLint limits: `max-lines: 200`, `max-lines-per-function: 50`, `no-console`, `no-inline-comments`
- Docblocks on every module; method bodies without blank lines
- See [CLAUDE.md](../CLAUDE.md) for layer rules and the ingest pipeline diagram

## CI and releases

The [release workflow](../.github/workflows/release.yml) runs the version check, lint, Node.js tests, control integration and Scala stream processing tests and assembly on `main`. Tagging and npm publication require the relevant checks to pass. Downstream deployment repositories build plant container images.

## Measurements

- [SQLite delivery spool capacity](measurements/2026-11-11-delivery-spool.md)
- [Bounded group-commit measurement](measurements/2026-11-11-group-commit.md)

---

← [Timeline persistence](reference/timeline-persistence.md)
