# Resolve the same daemon Docker would use, then bind each command to that socket.
if [[ -n ${DOCKER_CONTEXT:-} ]]; then
    smoke_docker_host=$(docker context inspect --format '{{.Endpoints.docker.Host}}' "$DOCKER_CONTEXT")
elif [[ -n ${DOCKER_HOST:-} ]]; then
    smoke_docker_host=$DOCKER_HOST
else
    smoke_docker_host=$(docker context inspect --format '{{.Endpoints.docker.Host}}' "$(docker context show)")
fi
if [[ "$smoke_docker_host" != unix://* || ! -S ${smoke_docker_host#unix://} ]]; then
    printf 'The smoke test needs a local Docker Unix socket\n' >&2
    exit 1
fi

docker() {
    DOCKER_CONTEXT= DOCKER_HOST= command docker --host "$smoke_docker_host" "$@"
}
