#!/usr/bin/env bash
# Exercise the installed npm binary against an isolated k3s cluster.
set -euo pipefail
umask 077

cd "$(dirname "$0")/../.."
source test/smoke/local-docker.sh
scratch=$(mktemp -d)
cluster="scada-management-k3s-${scratch##*.}"
gateway_pid=''
cluster_started=''

cleanup() {
    result=$?
    if [[ -n $gateway_pid ]]; then
        kill "$gateway_pid" 2>/dev/null || true
        wait "$gateway_pid" 2>/dev/null || true
    fi
    if [[ $result != 0 && -f $scratch/server.err ]]; then
        cat "$scratch/server.err" >&2
    fi
    if [[ -n $cluster_started ]]; then
        if [[ $result != 0 ]]; then
            docker logs --tail 50 "$cluster" >&2 || true
        fi
        docker rm -f -v "$cluster" >/dev/null || true
    fi
    rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

image=busybox:1.37.0
docker pull "$image" >/dev/null
cluster_started=1
docker run --detach --privileged --cgroupns=private --name "$cluster" --publish 127.0.0.1::6443 \
    rancher/k3s:v1.35.3-k3s1 server --disable=traefik,servicelb,local-storage,metrics-server,coredns \
    --flannel-backend=host-gw --snapshotter=native > /dev/null

# This kubeconfig comes only from the test container. Never select a host context.
export KUBECONFIG="$scratch/kubeconfig"
unset HELM_KUBEAPISERVER HELM_KUBECAFILE HELM_KUBECONTEXT HELM_KUBETOKEN HELM_KUBEASUSER HELM_KUBEASGROUPS
unset HELM_KUBEINSECURE_SKIP_TLS_VERIFY HELM_KUBETLS_SERVER_NAME HELM_NAMESPACE HELM_DRIVER HELM_DRIVER_SQL_CONNECTION_STRING
for ((attempt=0; attempt<90; attempt+=1)); do
    if docker exec "$cluster" cat /etc/rancher/k3s/k3s.yaml > "$KUBECONFIG" 2>/dev/null && [[ -s $KUBECONFIG ]]; then
        break
    fi
    sleep 1
done
chmod 600 "$KUBECONFIG"
kube_port=$(docker port "$cluster" 6443/tcp)
kubectl config set-cluster default --server="https://$kube_port" >/dev/null
registered=''
for ((attempt=0; attempt<90; attempt+=1)); do
    if registered=$(kubectl --context default --request-timeout=3s get nodes -o name 2>/dev/null) &&
        [[ -n $registered ]]; then
        break
    fi
    sleep 1
done
[[ -n $registered ]] || { echo 'k3s did not register a node' >&2; exit 1; }
kubectl --context default wait --for=condition=Ready node --all --timeout=90s
platform="linux/$(docker image inspect --format '{{.Architecture}}' "$image")"
docker image save "$image" | docker exec -i "$cluster" /bin/ctr --address /run/k3s/containerd/containerd.sock \
    --namespace k8s.io images import --local --platform "$platform" --snapshotter native - >/dev/null

pack=$(npm pack --pack-destination "$scratch" --silent)
npm --prefix "$scratch/client" install --omit=dev --no-audit --no-fund "$scratch/$pack"
scada="$scratch/client/node_modules/.bin/scada"
"$scada" --help | grep -F 'scada apply'

cat > "$scratch/helm-values.json" <<EOF_VALUES
{"site":{"enabled":false},"sink":{"enabled":false},"postgres":{"enabled":false},"rabbitmq":{"enabled":false},
 "image":"$image","processes":[{"name":"reader","command":["sh","-c","echo smoke-reader; exec sleep 3600"]}]}
EOF_VALUES
node --input-type=module - "$scratch" <<'EOF_PLAN'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.argv[2];
const values = JSON.parse(readFileSync(join(directory, 'helm-values.json'), 'utf8'));
writeFileSync(join(directory, 'release-plan.json'), JSON.stringify({
    values, fieldManager: 'scada-smoke', workloads: ['deployment/ssa-reader']
}));
EOF_PLAN
cat > "$scratch/management.json" <<'EOF_CONFIG'
{"contexts":{
  "helm":{"runtime":"kubernetes","kubeContext":"default","namespace":"smoke-helm","release":"helm","values":"helm-values.json"},
  "ssa":{"runtime":"kubernetes","kubeContext":"default","namespace":"smoke-ssa","release":"ssa","releasePlan":"release-plan.json"}
}}
EOF_CONFIG

openssl req -new -newkey rsa:2048 -nodes -x509 -days 1 -subj /CN=127.0.0.1 \
    -addext subjectAltName=IP:127.0.0.1 -keyout "$scratch/key.pem" -out "$scratch/cert.pem" 2>"$scratch/tls.err"
export SCADA_TOKEN='smoke-writer'
export SCADA_READ_TOKEN='smoke-reader'
export NODE_EXTRA_CA_CERTS="$scratch/cert.pem"
HELM_KUBEAPISERVER=https://127.0.0.1:1 "$scada" serve --config "$scratch/management.json" --port 0 \
    --cert "$scratch/cert.pem" --key "$scratch/key.pem" >"$scratch/server.out" 2>"$scratch/server.err" &
gateway_pid=$!
for ((attempt=0; attempt<15; attempt+=1)); do
    if [[ -s $scratch/server.out ]]; then
        break
    fi
    kill -0 "$gateway_pid"
    sleep 1
done
SCADA_SERVER=$(cat "$scratch/server.out")
export SCADA_SERVER
cd "$scratch"
"$scada" contexts | grep -F kubernetes

for target in helm ssa; do
    namespace="smoke-$target"
    kubectl --context default create namespace "$namespace"
    SCADA_TOKEN=$SCADA_READ_TOKEN "$scada" plan --context "$target" | grep -F reconcile
    [[ -z $(kubectl --context default -n "$namespace" get deployments -o name) ]]
    if SCADA_TOKEN=$SCADA_READ_TOKEN "$scada" apply --context "$target"; then
        echo 'read-only apply unexpectedly succeeded' >&2
        exit 1
    fi
    [[ -z $(kubectl --context default -n "$namespace" get deployments -o name) ]]
    "$scada" apply --context "$target" | grep -F reconcile
    "$scada" logs "deployment/$target-reader" --context "$target" | grep -Fx smoke-reader
    "$scada" apply --context "$target" | grep -F reconcile
done

"$scada" status | grep -Fx $'helm\tdeployment/helm-reader\tready'
"$scada" status | grep -Fx $'ssa\tdeployment/ssa-reader\tready'
helm --kube-context default --namespace smoke-helm status helm | grep -F 'STATUS: deployed'
kubectl --context default -n smoke-ssa get deployment ssa-reader --show-managed-fields \
    -o 'jsonpath={.metadata.managedFields[*].manager}' | grep -F scada-smoke
echo 'PASS: installed scada CLI, HTTPS, k3s status and logs, Helm and server-side dry-run/apply/retry'
