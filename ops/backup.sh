#!/usr/bin/env sh
set -eu

DATABASE_URL="${DATABASE_URL:-${BACKUP_DATABASE_URL:-}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL or BACKUP_DATABASE_URL is required" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARCHIVE_PATH="$BACKUP_DIR/jobfinder-$TIMESTAMP.sql.gz"
SQL_PATH="$BACKUP_DIR/jobfinder-$TIMESTAMP.sql"

cleanup() {
  rm -f "$SQL_PATH"
}
trap cleanup EXIT

pg_dump --dbname="$DATABASE_URL" --no-owner --no-privileges --file="$SQL_PATH"
gzip -c "$SQL_PATH" > "$ARCHIVE_PATH"

find "$BACKUP_DIR" -type f -name '*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -delete

echo "Backup written to $ARCHIVE_PATH"
