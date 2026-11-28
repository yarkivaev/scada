# AGENTS.md

`@yarkivaev/scada` is factory-agnostic. Supply plant-specific identifiers, runtime policy, deployment settings, and business rules through the application. Use fictional installations and identifiers in examples and tests.

Opaque operation kinds and generic ports (`latestForMachine`, list/upsert/stream) are fine. See `README.md` § Package boundary and `CLAUDE.md`.

The shared collector runtime lives under `src/`. The Scala stream processor lives in `stream-processing/`; plant profiles supply their own classifier and configuration.

## Testing and release policy

- CI runs test suites only on `main`. Feature branches and PRs/MRs do not run full CI tests.
- Before every push, inspect the diff and run the tests most likely affected by the change, including dependent callers and shared contracts. Fix failures before pushing.
- For shared infrastructure, dependency, schema, or cross-component changes, broaden the selected suites; run the full suite when the impact cannot be bounded confidently. Documentation-only changes need no application tests.
- Report the exact commands and results in the handoff/PR/MR. Explicitly list checks not run and why; a missing environment is not a passing test.
- Do not wait for a full feature-branch CI test run or repeatedly run unrelated suites. Full regression checks run on `main`; a separate repair agent handles regressions there.
- Production releases must use the exact commit from `main` whose mandatory checks passed. Never bypass this gate with skip variables, manually created tags, or an unrelated green pipeline. Do not deploy a commit whose mandatory checks failed or were skipped.

### Targeted commands

Use `npx mocha --exit test/path/to/test.js` to select files or `npm test -- --grep "pattern"` to select cases. Run integration tests for changed persistence/messaging adapters and their contracts. Use `npm test` for broad changes; run `npm run lint` when JavaScript or lint configuration changes.

The Scala release check runs `cd stream-processing && sbt test assembly` with JDK 21.
