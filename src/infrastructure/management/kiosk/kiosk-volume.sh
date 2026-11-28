#!/usr/bin/env bash
# Set and verify kiosk speaker volume.
#
# Env:
#   VOLUME_PERCENT — integer 0-100 (required)
#   KIOSK_USER — PipeWire session user (default kiosk)
#   AMIXER_CMD — amixer binary (default amixer)
#   AMIXER_CARD — ALSA card index (default 0)
#   WPCTL_CMD — wpctl binary (default wpctl)
#   ID_CMD — id binary (default id)
#   PULSE_SOCKET — override Pulse native socket path
#
# Usage: kiosk-volume.sh
set -eu
set -o pipefail

percent="${VOLUME_PERCENT:-}"
case "$percent" in
  ''|*[!0-9]*)
    echo "VOLUME_PERCENT must be an integer 0-100, got '${percent}'" >&2
    exit 2
    ;;
esac
if [ "$percent" -gt 100 ]; then
  echo "VOLUME_PERCENT must be an integer 0-100, got '${percent}'" >&2
  exit 2
fi

amixer="${AMIXER_CMD:-amixer}"
card="${AMIXER_CARD:-0}"
wpctl="${WPCTL_CMD:-wpctl}"
idcmd="${ID_CMD:-id}"
user="${KIOSK_USER:-kiosk}"

action="${KIOSK_AUDIO_ACTION:-check}"
case "$action" in check|apply) ;; *) echo "Invalid audio action" >&2; exit 2 ;; esac
if [ "$action" = apply ]; then
  "$amixer" -q -c "$card" sset Master "${percent}%" unmute
fi
mixer="$("$amixer" -c "$card" sget Master)"
found=0
while IFS= read -r line; do
  case "$line" in
    *Playback*'['*'%]'*|*'['*'%]'*'[on]'*|*'['*'%]'*'[off]'*)
      case "$line" in
        *Mono:*|*'Front '*:*|*Playback*)
          found=1
          case "$line" in
            *"[$percent%]"*'[on]'*|*'[on]'*"[$percent%]")
              ;;
            *)
              echo "ALSA Master is not ${percent}% unmuted: ${line}" >&2
              echo "$mixer" >&2
              exit 1
              ;;
          esac
          ;;
      esac
      ;;
  esac
done <<EOF
$mixer
EOF
if [ "$found" -eq 0 ]; then
  echo "ALSA Master has no Playback percent reading" >&2
  echo "$mixer" >&2
  exit 1
fi

uid="$("$idcmd" -u "$user")"
runtime="/run/user/${uid}"
socket="${PULSE_SOCKET:-${runtime}/pulse/native}"
if [ ! -S "$socket" ]; then
  echo "Pulse socket is missing at ${socket}" >&2
  exit 1
fi

export XDG_RUNTIME_DIR="$runtime"
if [ "$action" = apply ]; then
  "$wpctl" set-volume @DEFAULT_AUDIO_SINK@ "${percent}%"
  "$wpctl" set-mute @DEFAULT_AUDIO_SINK@ 0
fi
vol="$("$wpctl" get-volume @DEFAULT_AUDIO_SINK@)"
level="$(printf '%s\n' "$vol" | awk '/Volume:/{print $2; exit}')"
if [ -z "$level" ]; then
  echo "PipeWire sink has no volume reading: ${vol}" >&2
  exit 1
fi
if ! awk -v got="$level" -v p="$percent" 'BEGIN {
  want = p / 100
  diff = got - want
  if (diff < 0) diff = -diff
  exit (diff < 0.015) ? 0 : 1
}'; then
  echo "PipeWire sink is not ${percent}%: ${vol}" >&2
  exit 1
fi
case "$vol" in
  *MUTED*)
    echo "PipeWire sink is still muted: ${vol}" >&2
    exit 1
    ;;
esac

printf "Kiosk audio verified: %s%%, unmuted\n" "$percent"
