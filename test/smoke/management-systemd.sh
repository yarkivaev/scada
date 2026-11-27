#!/usr/bin/env bash
# Exercise a real systemd and journald in a disposable Linux container.
set -euo pipefail
umask 077

repo="$(cd "$(dirname "$0")/../.." && pwd)"
source "$repo/test/smoke/local-docker.sh"
scratch="$(mktemp -d)"
image="scada-management-systemd-smoke:$(basename "$scratch" | tr '[:upper:]' '[:lower:]')"
container=""
hub_pid=""

cleanup() {
    local result=$?
    if [[ "$result" -ne 0 ]]; then
        [[ ! -f "$scratch/hub.err" ]] || cat "$scratch/hub.err" >&2
        if [[ -n "$container" ]]; then
            docker logs --tail 40 "$container" >&2 || true
            docker exec "$container" sh -c 'test ! -f /tmp/scada-edge.log || cat /tmp/scada-edge.log' >&2 || true
        fi
    fi
    [[ -z "$hub_pid" ]] || kill "$hub_pid" 2>/dev/null || true
    [[ -z "$hub_pid" ]] || wait "$hub_pid" 2>/dev/null || true
    [[ -z "$container" ]] || docker rm -f "$container" >/dev/null 2>&1 || true
    docker image rm "$image" >/dev/null 2>&1 || true
    rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for() {
    local deadline=$((SECONDS + 60))
    until "$@"; do
        if (( SECONDS >= deadline )); then
            printf 'Timed out waiting for %s\n' "$1" >&2
            return 1
        fi
        sleep 1
    done
}

json_equal() {
    node -e 'const assert = require("node:assert/strict");
        assert.deepEqual(JSON.parse(require("node:fs").readFileSync(0, "utf8")), JSON.parse(process.argv[1]));' "$1"
}

test -f "$repo/node_modules/zod/package.json"
openssl req -new -newkey rsa:2048 -nodes -x509 -subj '/CN=127.0.0.1' \
    -addext 'subjectAltName=IP:127.0.0.1' -days 1 -keyout "$scratch/key.pem" \
    -out "$scratch/cert.pem" 2>"$scratch/openssl.log"

cat >"$scratch/scada-smoke.service" <<'UNIT'
[Service]
ExecStart=/bin/sh -c 'echo scada-systemd-smoke-ready; exec /bin/sleep infinity'
UNIT

cat >"$scratch/edge.json" <<'JSON'
{"contexts":{"local":{"runtime":"systemd","units":{"scada-smoke.service":"running"}}}}
JSON

docker build --quiet --tag "$image" - <<'DOCKER'
FROM node:22-bookworm
RUN apt-get -o Acquire::Retries=2 update \
 && apt-get install --no-install-recommends -y systemd systemd-sysv \
 && rm -rf /var/lib/apt/lists/*
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
DOCKER

# The container has its own writable cgroup namespace and ephemeral unit state.
container="$(docker run --detach --privileged --cgroupns=private \
    --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --publish 127.0.0.1::8443 \
    --mount "type=bind,source=$repo/src,target=/scada/src,readonly" \
    --mount "type=bind,source=$repo/package.json,target=/scada/package.json,readonly" \
    --mount "type=bind,source=$repo/node_modules/zod,target=/scada/node_modules/zod,readonly" \
    --mount "type=bind,source=$scratch,target=/fixtures,readonly" \
    --mount "type=bind,source=$scratch/scada-smoke.service,target=/etc/systemd/system/scada-smoke.service,readonly" \
    "$image")"

edge_ready() {
    docker exec "$container" systemctl is-active --quiet systemd-journald.service &&
        [[ "$(docker exec "$container" systemctl show --property=LoadState --value scada-smoke.service)" == loaded ]]
}
wait_for edge_ready

edge_token="$(openssl rand -hex 24)"
docker exec --detach --env "SCADA_TOKEN=$edge_token" "$container" \
    sh -c 'exec "$@" >/tmp/scada-edge.log 2>&1' scada-edge node /scada/src/bin/scada.js serve --host 0.0.0.0 --port 8443 \
    --config /fixtures/edge.json --cert /fixtures/cert.pem --key /fixtures/key.pem
edge_url="https://$(docker port "$container" 8443/tcp)"
export NODE_EXTRA_CA_CERTS="$scratch/cert.pem"

probe_edge() {
    SCADA_TOKEN="$edge_token" node "$repo/src/bin/scada.js" contexts --server "$edge_url" >/dev/null 2>&1
}
wait_for probe_edge

printf '{"contexts":{"edge":{"runtime":"remote","server":"%s","context":"local","tokenEnv":"EDGE_MANAGEMENT_TOKEN"}}}\n' \
    "$edge_url" >"$scratch/hub.json"
hub_token="$(openssl rand -hex 24)"
read_token="$(openssl rand -hex 24)"
SCADA_TOKEN="$hub_token" SCADA_READ_TOKEN="$read_token" EDGE_MANAGEMENT_TOKEN="$edge_token" \
    node "$repo/src/bin/scada.js" serve --port 0 --config "$scratch/hub.json" \
    --cert "$scratch/cert.pem" --key "$scratch/key.pem" >"$scratch/hub.out" 2>"$scratch/hub.err" &
hub_pid=$!
wait_for test -s "$scratch/hub.out"
export SCADA_SERVER
SCADA_SERVER="$(head -n 1 "$scratch/hub.out")"

client() {
    local credential="$1"
    shift
    SCADA_TOKEN="$credential" node "$repo/src/bin/scada.js" "$@" --output json
}

client "$read_token" plan --context edge |
    json_equal '{"changes":[{"id":"scada-smoke.service","action":"start"}]}'
if client "$read_token" apply --context edge >"$scratch/denied.out" 2>"$scratch/denied.err"; then
    printf 'Read credential unexpectedly applied the service\n' >&2
    exit 1
fi
grep -q 'forbidden' "$scratch/denied.err"
docker exec "$container" systemctl show --property=ActiveState --value scada-smoke.service     | grep -qx inactive

client "$hub_token" apply --context edge |
    json_equal '{"changes":[{"id":"scada-smoke.service","action":"start"}]}'
client "$read_token" status --context edge |
    json_equal '{"contexts":[{"name":"edge","components":[{"id":"scada-smoke.service","state":"ready"}]}]}'
client "$hub_token" apply --context edge | json_equal '{"changes":[]}'

logged() {
    client "$read_token" logs scada-smoke.service --context edge --tail 10 |
        node -e 'const data = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
            process.exitCode = data.logs.includes("scada-systemd-smoke-ready") ? 0 : 1;'
}
wait_for logged
printf 'systemd smoke passed: HTTPS forwarding, denied read-only apply, real service start, retry and journal read\n'
