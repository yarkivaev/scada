[Documentation](../README.md) / [Operations](README.md)

# Database migrations

Select a PostgreSQL schema profile and decide whether supervisor-sink applies or verifies migrations at startup.

## Select a profile

Use `SINK_DB_PROFILE=edge` for an edge site and `SINK_DB_PROFILE=central` for a central site. The profile selects which PostgreSQL migration files to check.

| Mode | When to use | Startup credentials |
| --- | --- | --- |
| `apply` (default) | The application is responsible for applying migrations at startup. | `POSTGRES_ADMIN_URL` for migrations and `POSTGRES_URL` for runtime access. |
| `verify` | A separate administrative job applies the complete migration set. | Restricted `POSTGRES_URL`. |

The prefixes below are used by the [migration directory](../../db/migrations).

| Prefix | Applies to |
|--------|------------|
| `V*` | Both central and edge |
| `E*` | Edge only (metrics tables, retention) |
| `C*` | Central only (central privileges, including segment DELETE) |

## Run with a restricted database role

1. Use the image built from the exact `main` commit whose mandatory checks passed.
2. Apply the image's complete shared and selected-profile migration set with an administrative identity in a separate job.
3. Give the runtime role database `CONNECT`, schema `USAGE`, read access to `public.schema_migrations` and the DML and sequence grants required by the enabled pipelines.
4. Set `SUPERVISOR_MIGRATIONS=verify` and expose the restricted connection string through `POSTGRES_URL`. Keep the administrative credentials in the bootstrap job.
5. Start the application and check its startup output. It checks migration records before opening HTTP or starting consumers. Missing migration records or an unreadable migration table stop verification. Verification reads the migration manifest and recorded versions. Validate the tables, functions, runtime grants and sequences separately.

The collector task-state migration is separately opt-in. For timeline replication v2, apply the shared position table and grants in `V0016` and `V0017` on authorities and recipients. Edge authorities also need `E0021` through `E0024` for outbox storage, capture and grants.

## Configure Helm

For chart-managed PostgreSQL, create distinct bootstrap and runtime Secrets. The example uses `postgres-bootstrap` and `postgres-runtime`.

```yaml
postgres:
  migrationsMode: verify
  secret: postgres-bootstrap
  runtimeSecret: postgres-runtime
```

`runtimeSecret` must differ from the bootstrap Secret and contain the restricted
connection string under `url`. The chart injects it as POSTGRES_URL, sets
SUPERVISOR_MIGRATIONS=verify, and omits POSTGRES_ADMIN_URL from both application
containers. Bootstrap credentials remain on PostgreSQL. Apply mode keeps the
legacy adminUrl reference; an optional runtimeSecret can separately supply its
POSTGRES_URL. With postgres.enabled=false, explicit application env values
continue to configure external databases without generated PostgreSQL settings. Keep administrative credentials out of both `env` and `envFrom` in verify mode.

---

← [Operations](README.md) · [Broker credentials](broker-credentials.md) →
