#!/bin/sh
set -eu
hba="$PGDATA/pg_hba.conf"
awk '
  /^# DSL target pod CIDRs/ { next }
  $1 == "host" && $2 == "all" && $3 == "all" { next }
  { print }
' "$hba" > "$hba.dsl"
cat /pg-auth/pg_hba.conf.fragment >> "$hba.dsl"
cat "$hba.dsl" > "$hba"
rm -f "$hba.dsl"
