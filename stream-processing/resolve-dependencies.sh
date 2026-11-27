#!/bin/sh
set -eu

cd "$(dirname "$0")"

download_dependency() (
    name=$1
    version=$(sed -n '1p' "$name.lock")
    expected=$(sed -n '2p' "$name.lock")
    case "$version" in
        ''|*[!0-9.]*) printf 'Invalid %s version\n' "$name" >&2; exit 1 ;;
    esac
    case "$expected" in
        ''|*[!a-f0-9]*) printf 'Invalid %s SHA-256\n' "$name" >&2; exit 1 ;;
    esac
    test "${#expected}" -eq 64

    correct() {
        test -f "$1" && test "$(sha256sum "$1" | cut -d ' ' -f 1)" = "$expected"
    }
    jar="dependencies/$name.jar"
    if correct "$jar"; then
        exit 0
    fi

    download=$(mktemp ".${name}.XXXXXX")
    trap 'rm -f "$download"' EXIT HUP INT TERM
    url="https://github.com/yarkivaev/$name/releases/download/v$version/${name}_3-$version.jar"
    curl -fsSL --retry 2 --connect-timeout 10 --max-time 90 "$url" -o "$download"
    if ! correct "$download"; then
        printf '%s SHA-256 mismatch\n' "$name" >&2
        exit 1
    fi
    mkdir -p dependencies
    mv "$download" "$jar"
)

download_dependency stream-worker
download_dependency timeline-segmentation
