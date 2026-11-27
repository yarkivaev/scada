#!/bin/sh
set -eu

cd "$(dirname "$0")"

version=$(sed -n '1p' stream-worker.lock)
expected=$(sed -n '2p' stream-worker.lock)
case "$version" in
    ''|*[!0-9.]*) printf '%s\n' 'Invalid Stream Worker version' >&2; exit 1 ;;
esac
case "$expected" in
    ''|*[!a-f0-9]*) printf '%s\n' 'Invalid Stream Worker SHA-256' >&2; exit 1 ;;
esac
test "${#expected}" -eq 64

jar=dependencies/stream-worker.jar
correct() {
    test -f "$1" && test "$(sha256sum "$1" | cut -d ' ' -f 1)" = "$expected"
}
if correct "$jar"; then
    exit 0
fi

download=$(mktemp .stream-worker.XXXXXX)
trap 'rm -f "$download"' EXIT HUP INT TERM
url="https://github.com/yarkivaev/stream-worker/releases/download/v$version/stream-worker_3-$version.jar"
curl -fsSL --retry 2 --connect-timeout 10 --max-time 90 "$url" -o "$download"
if ! correct "$download"; then
    printf '%s\n' 'Stream Worker SHA-256 mismatch' >&2
    exit 1
fi
mkdir -p dependencies
mv "$download" "$jar"
