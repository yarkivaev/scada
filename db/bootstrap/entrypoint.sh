#!/bin/sh
set -eu
if [ -f "$PGDATA/PG_VERSION" ]; then
    /pg-auth/apply-hba.sh
fi
exec /usr/local/bin/docker-entrypoint.sh postgres
