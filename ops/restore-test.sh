#!/usr/bin/env sh
set -eu

BACKUP_FILE="${1:-${BACKUP_FILE:-}}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$BACKUP_FILE" ] || [ -z "$TARGET_DATABASE_URL" ]; then
  echo "Usage: TARGET_DATABASE_URL=postgres://... $0 <backup-file.sql.gz>" >&2
  exit 1
fi

TARGET_DB_NAME="$(printf '%s' "$TARGET_DATABASE_URL" | sed -E 's#^.*/([^/?]+).*$#\1#')"

case "$TARGET_DB_NAME" in
  *test*|*restore*) ;;
  *)
    echo "Refusing restore into non-test database: $TARGET_DB_NAME" >&2
    exit 1
    ;;
esac

gunzip -c "$BACKUP_FILE" | psql "$TARGET_DATABASE_URL"
