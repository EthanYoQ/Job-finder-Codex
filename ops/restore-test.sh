#!/usr/bin/env sh
set -eu

BACKUP_FILE="${1:-${BACKUP_FILE:-}}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-}"

if [ -z "$BACKUP_FILE" ] || [ -z "$TARGET_DATABASE_URL" ]; then
  echo "Usage: TARGET_DATABASE_URL=postgres://... $0 <backup-file.dump>" >&2
  exit 1
fi

TARGET_URL_WITHOUT_QUERY="${TARGET_DATABASE_URL%%\?*}"
TARGET_DB_NAME="${TARGET_URL_WITHOUT_QUERY##*/}"

case "$TARGET_DB_NAME" in
  test|restore|test[-_]*|restore[-_]*|*[-_]test|*[-_]restore|*[-_]test[-_]*|*[-_]restore[-_]*) ;;
  *)
    echo "Refusing restore into non-test database: $TARGET_DB_NAME" >&2
    exit 1
    ;;
esac

CHECKSUM_FILE="$BACKUP_FILE.sha256"
if [ ! -f "$BACKUP_FILE" ] || [ ! -f "$CHECKSUM_FILE" ]; then
  echo "Backup and final SHA256 commit marker are required" >&2
  exit 1
fi

CHECKSUM_LINE_COUNT="$(wc -l < "$CHECKSUM_FILE" | tr -d '[:space:]')"
if [ "$CHECKSUM_LINE_COUNT" != "1" ] || ! grep -Eq '^[0-9a-f]{64}  [^[:space:]][^[:cntrl:]]*$' "$CHECKSUM_FILE"; then
  echo "Invalid SHA256 commit marker: $CHECKSUM_FILE" >&2
  exit 1
fi
CHECKSUM_LINE="$(cat "$CHECKSUM_FILE")"
EXPECTED_SHA256="${CHECKSUM_LINE%%  *}"
EXPECTED_ARCHIVE_NAME="${CHECKSUM_LINE#*  }"
case "$EXPECTED_SHA256" in
  ""|*[!0-9a-f]*)
    echo "Invalid SHA256 commit marker: $CHECKSUM_FILE" >&2
    exit 1
    ;;
esac
if [ "${#EXPECTED_SHA256}" -ne 64 ] || [ "$EXPECTED_ARCHIVE_NAME" != "$(basename "$BACKUP_FILE")" ]; then
  echo "SHA256 commit marker does not bind to the requested backup" >&2
  exit 1
fi

ACTUAL_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"
if [ "$EXPECTED_SHA256" != "$ACTUAL_SHA256" ]; then
  echo "Backup SHA256 verification failed" >&2
  exit 1
fi

PSQL_VERSION="$(psql --version)"
case "$PSQL_VERSION" in
  "psql (PostgreSQL) 16."*) ;;
  *)
    echo "PostgreSQL 16 psql is required; found: $PSQL_VERSION" >&2
    exit 1
    ;;
esac

PG_RESTORE_VERSION="$(pg_restore --version)"
case "$PG_RESTORE_VERSION" in
  "pg_restore (PostgreSQL) 16."*) ;;
  *)
    echo "PostgreSQL 16 pg_restore is required; found: $PG_RESTORE_VERSION" >&2
    exit 1
    ;;
esac

TARGET_TABLE_COUNT="$(psql --dbname="$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_%';")"
if [ "$TARGET_TABLE_COUNT" != "0" ]; then
  echo "Refusing restore into a target with application tables" >&2
  exit 1
fi

MIGRATION_TABLE_PRESENT="$(psql --dbname="$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT CASE WHEN to_regclass('public.\"_prisma_migrations\"') IS NULL THEN 0 ELSE 1 END;")"
if [ "$MIGRATION_TABLE_PRESENT" != "0" ]; then
  echo "Refusing restore into a target containing _prisma_migrations" >&2
  exit 1
fi

pg_restore --list "$BACKUP_FILE" >/dev/null
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname="$TARGET_DATABASE_URL" "$BACKUP_FILE"
