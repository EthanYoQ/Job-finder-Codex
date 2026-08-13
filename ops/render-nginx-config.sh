#!/bin/sh
set -eu

hostname="${PUBLIC_HOSTNAME:-}"
https_port="${PUBLIC_HTTPS_PORT:-443}"
template="${NGINX_TEMPLATE_PATH:-/etc/nginx/templates/default.conf.template}"
output="${NGINX_RENDERED_CONFIG_PATH:-/tmp/jobfinder-ingress.conf}"

if [ "${#hostname}" -gt 253 ] || ! printf '%s\n' "$hostname" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$'; then
  echo 'PUBLIC_HOSTNAME must be one canonical DNS hostname' >&2
  exit 1
fi
case "$https_port" in
  ''|*[!0-9]*) echo 'PUBLIC_HTTPS_PORT must be an integer from 1 through 65535' >&2; exit 1 ;;
esac
if [ "$https_port" -lt 1 ] || [ "$https_port" -gt 65535 ]; then
  echo 'PUBLIC_HTTPS_PORT must be an integer from 1 through 65535' >&2
  exit 1
fi

if [ "$https_port" = 443 ]; then
  PUBLIC_HTTPS_AUTHORITY="$hostname"
else
  PUBLIC_HTTPS_AUTHORITY="$hostname:$https_port"
fi
export PUBLIC_HOSTNAME PUBLIC_HTTPS_AUTHORITY
envsubst '$PUBLIC_HOSTNAME $PUBLIC_HTTPS_AUTHORITY' < "$template" > "$output"
