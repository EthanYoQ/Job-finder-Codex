#!/usr/bin/env sh

# Prisma accepts a `schema` URL parameter, while PostgreSQL command-line
# clients reject it. Remove only that application-specific parameter and
# preserve every other connection option for libpq.
normalize_libpq_database_url() {
  input_url="$1"
  case "$input_url" in
    *\?*) ;;
    *)
      printf '%s\n' "$input_url"
      return
      ;;
  esac

  base_url="${input_url%%\?*}"
  query_string="${input_url#*\?}"
  normalized_url="$base_url"
  separator="?"
  previous_ifs="$IFS"
  IFS="&"
  set -f
  set -- $query_string
  set +f
  IFS="$previous_ifs"

  for parameter do
    case "${parameter%%=*}" in
      schema) continue ;;
    esac
    [ -n "$parameter" ] || continue
    normalized_url="${normalized_url}${separator}${parameter}"
    separator="&"
  done

  printf '%s\n' "$normalized_url"
}
