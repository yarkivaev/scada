#!/bin/sh
logts() {
  date -Iseconds 2>/dev/null || date
}
try_kill() {
  if [ "${WATCHDOG_KILL:-0}" != "1" ]; then
    return
  fi
  if [ -z "${KIOSK_CHROMIUM_USER_DATA:-}" ]; then
    return
  fi
  ts=$(logts)
  pat="chromium.*--user-data-dir=${KIOSK_CHROMIUM_USER_DATA}"
  for pid in $(pgrep -f "$pat" 2>/dev/null); do
    echo "${ts} watchdog kill_TERM pid=${pid}" >&2
    kill -TERM "$pid" 2>/dev/null || true
  done
}
die_immediate() {
  ts=$(logts)
  echo "${ts} watchdog $1" >&2
  try_kill
  exit 1
}
WATCHDOG_INTERVAL="${WATCHDOG_INTERVAL:-30}"
WATCHDOG_TIMEOUT="${WATCHDOG_TIMEOUT:-5}"
WATCHDOG_STARTUP_MAX_WAIT="${WATCHDOG_STARTUP_MAX_WAIT:-120}"
WATCHDOG_UNHEALTHY_STREAK="${WATCHDOG_UNHEALTHY_STREAK:-3}"
CDP_PORT="${CDP_PORT:-9222}"
BASE="http://127.0.0.1:${CDP_PORT}"
LAST_REASON=""
tier2_url_has_origin() {
  o=$1
  if printf '%s' "${list}" | grep -qF "\"url\":\"${o}"; then
    return 0
  fi
  if printf '%s' "${list}" | grep -qF "\"url\": \"${o}"; then
    return 0
  fi
  return 1
}
wait_cdp_ready() {
  step=2
  elapsed=0
  while [ "${elapsed}" -lt "${WATCHDOG_STARTUP_MAX_WAIT}" ]; do
    if wget -qO- -T "${WATCHDOG_TIMEOUT}" "${BASE}/json/version" >/dev/null 2>&1; then
      echo "$(logts) watchdog startup_cdp_ok elapsed=${elapsed}s" >&2
      return 0
    fi
    sleep "${step}"
    elapsed=$((elapsed + step))
  done
  echo "$(logts) watchdog startup_cdp_timeout wait=${WATCHDOG_STARTUP_MAX_WAIT}s" >&2
  exit 1
}
one_check() {
  LAST_REASON=""
  list=$(wget -qO- -T "${WATCHDOG_TIMEOUT}" "${BASE}/json/list") || {
    LAST_REASON=list_fetch_fail
    return 1
  }
  case ${list} in
  *chrome-error://chromewebdata/*)
    LAST_REASON=tier1_chrome_error
    return 2
    ;;
  *chrome://crash*)
    LAST_REASON=tier1_chrome_crash
    return 2
    ;;
  *chrome://kill*)
    LAST_REASON=tier1_chrome_kill
    return 2
    ;;
  esac
  if [ -n "${KIOSK_PAGE_ORIGIN:-}" ]; then
    case ${list} in
    *'"type":"page"'*|*'"type": "page"'*) ;;
    *)
      LAST_REASON=tier2_no_page_target
      return 1
      ;;
    esac
    if tier2_url_has_origin "${KIOSK_PAGE_ORIGIN}"; then
      :
    elif [ -n "${KIOSK_PAGE_ORIGIN_ALT:-}" ] && tier2_url_has_origin "${KIOSK_PAGE_ORIGIN_ALT}"; then
      :
    else
      LAST_REASON=tier2_hmi_origin_not_in_targets
      return 1
    fi
  fi
  ver=$(wget -qO- -T "${WATCHDOG_TIMEOUT}" "${BASE}/json/version") || {
    LAST_REASON=cdp_version_fetch_fail
    return 1
  }
  case ${ver} in
  *'"Browser"'*) ;;
  *)
    LAST_REASON=cdp_version_no_browser_field
    return 1
    ;;
  esac
  case ${ver} in
  *Chromium*|*Chrome*) ;;
  *)
    LAST_REASON=cdp_version_not_chromium
    return 1
    ;;
  esac
  return 0
}
wait_cdp_ready
streak=0
while true; do
  one_check
  rc=$?
  if [ "${rc}" -eq 0 ]; then
    streak=0
    ts=$(logts)
    echo "${ts} watchdog ok list_tier1_tier2 version_ok" >&2
    touch /tmp/watchdog-ok
    sleep "${WATCHDOG_INTERVAL}"
  elif [ "${rc}" -eq 2 ]; then
    die_immediate "reason=${LAST_REASON}"
  else
    streak=$((streak + 1))
    ts=$(logts)
    echo "${ts} watchdog soft_fail streak=${streak} reason=${LAST_REASON}" >&2
    if [ "${streak}" -ge "${WATCHDOG_UNHEALTHY_STREAK}" ]; then
      echo "${ts} watchdog streak_exceeded exiting" >&2
      try_kill
      exit 1
    fi
    sleep "${WATCHDOG_INTERVAL}"
  fi
done
