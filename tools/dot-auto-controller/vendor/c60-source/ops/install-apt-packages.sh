#!/bin/sh
set -eu

if [ "$#" -eq 0 ]; then
  echo "At least one apt package is required" >&2
  exit 2
fi

APT_CONFIG_DIR="${APT_CONFIG_DIR:-/etc/apt/apt.conf.d}"
APT_TOTAL_TIMEOUT_SECONDS="${APT_TOTAL_TIMEOUT_SECONDS:-900}"
case "$APT_TOTAL_TIMEOUT_SECONDS" in
  ''|*[!0-9]*) echo "APT_TOTAL_TIMEOUT_SECONDS must be a positive integer" >&2; exit 2 ;;
  0) echo "APT_TOTAL_TIMEOUT_SECONDS must be a positive integer" >&2; exit 2 ;;
esac

mkdir -p "$APT_CONFIG_DIR"
rm -f "$APT_CONFIG_DIR/docker-clean"
printf '%s\n' 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > "$APT_CONFIG_DIR/keep-downloaded-packages"

exec timeout --signal=TERM --kill-after=10s "${APT_TOTAL_TIMEOUT_SECONDS}s" sh -eu -c '
  for attempt in 1 2 3; do
    if apt-get \
      -o Acquire::Retries=2 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 \
      update --error-on=any; then
      break
    fi
    if [ "$attempt" -eq 3 ]; then
      exit 1
    fi
    sleep 2
  done

  for attempt in 1 2 3; do
    if DEBIAN_FRONTEND=noninteractive apt-get \
      -o Acquire::Retries=2 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=30 \
      install -y --no-install-recommends "$@"; then
      exit 0
    fi
    if [ "$attempt" -eq 3 ]; then
      exit 1
    fi
    sleep 2
  done
  exit 1
' apt-install "$@"
