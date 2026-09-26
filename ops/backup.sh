#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
. "$SCRIPT_DIR/libpq-url.sh"

DATABASE_URL="${DATABASE_URL:-${BACKUP_DATABASE_URL:-}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_ATTEMPT_RECEIPT_PATH="$BACKUP_DIR/latest-backup-attempt.json"
BACKUP_ATTEMPTED_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"
BACKUP_TERMINAL_PUBLISHED=0
BACKUP_CLEANUP_READY=0

mkdir -p "$BACKUP_DIR"
publish_attempt() {
  node node_modules/tsx/dist/cli.mjs scripts/write-backup-attempt-receipt.ts "$BACKUP_ATTEMPT_RECEIPT_PATH" "$@"
}
backup_exit() {
  status=$?
  [ "$BACKUP_CLEANUP_READY" -eq 0 ] || cleanup
  if [ "$BACKUP_TERMINAL_PUBLISHED" -eq 0 ]; then
    completed_at="$(node -e 'process.stdout.write(new Date().toISOString())')"
    publish_attempt FAILED "$BACKUP_ATTEMPTED_AT" "$completed_at" || true
  fi
  exit "$status"
}
trap backup_exit EXIT
rm -f "$BACKUP_ATTEMPT_RECEIPT_PATH"
publish_attempt RUNNING "$BACKUP_ATTEMPTED_AT"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL or BACKUP_DATABASE_URL is required" >&2
  exit 1
fi
LIBPQ_DATABASE_URL="$(normalize_libpq_database_url "$DATABASE_URL")"

case "$BACKUP_RETENTION_DAYS" in
  ""|*[!0-9]*)
    echo "BACKUP_RETENTION_DAYS must be an integer from 7 through 14" >&2
    exit 1
    ;;
esac
if [ "$BACKUP_RETENTION_DAYS" -lt 7 ] || [ "$BACKUP_RETENTION_DAYS" -gt 14 ]; then
  echo "BACKUP_RETENTION_DAYS must be an integer from 7 through 14" >&2
  exit 1
fi

LOCK_PATH="$BACKUP_DIR/.jobfinder-backup.lock"
exec 9>"$LOCK_PATH"
if ! flock -n 9; then
  echo "Another backup process holds the backup lock" >&2
  exit 1
fi

PG_DUMP_VERSION="$(pg_dump --version)"
case "$PG_DUMP_VERSION" in
  "pg_dump (PostgreSQL) 16."*) ;;
  *)
    echo "PostgreSQL 16 pg_dump is required; found: $PG_DUMP_VERSION" >&2
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
SERVER_VERSION_NUM="$(psql --dbname="$LIBPQ_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command='SHOW server_version_num;')"
case "$SERVER_VERSION_NUM" in
  16????) ;;
  *) echo "PostgreSQL 16 server is required" >&2; exit 1 ;;
esac

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
ARCHIVE_PATH="$BACKUP_DIR/jobfinder-$TIMESTAMP.dump"
CHECKSUM_PATH="$ARCHIVE_PATH.sha256"
METADATA_PATH="$ARCHIVE_PATH.metadata.json"
PARTIAL_ARCHIVE_PATH="$ARCHIVE_PATH.partial"
PARTIAL_CHECKSUM_PATH="$CHECKSUM_PATH.partial"
PARTIAL_METADATA_PATH="$METADATA_PATH.partial"
OWNS_PARTIAL_ARCHIVE=0
OWNS_PARTIAL_CHECKSUM=0
OWNS_ARCHIVE=0
OWNS_CHECKSUM=0
OWNS_PARTIAL_METADATA=0
OWNS_METADATA=0

for candidate in "$ARCHIVE_PATH" "$CHECKSUM_PATH" "$METADATA_PATH" "$PARTIAL_ARCHIVE_PATH" "$PARTIAL_CHECKSUM_PATH" "$PARTIAL_METADATA_PATH"; do
  if [ -e "$candidate" ]; then
    echo "Refusing to overwrite existing backup artifact: $candidate" >&2
    exit 1
  fi
done

cleanup() {
  [ "$OWNS_PARTIAL_ARCHIVE" -eq 0 ] || rm -f "$PARTIAL_ARCHIVE_PATH"
  [ "$OWNS_PARTIAL_CHECKSUM" -eq 0 ] || rm -f "$PARTIAL_CHECKSUM_PATH"
  [ "$OWNS_ARCHIVE" -eq 0 ] || rm -f "$ARCHIVE_PATH"
  [ "$OWNS_CHECKSUM" -eq 0 ] || rm -f "$CHECKSUM_PATH"
  [ "$OWNS_PARTIAL_METADATA" -eq 0 ] || rm -f "$PARTIAL_METADATA_PATH"
  [ "$OWNS_METADATA" -eq 0 ] || rm -f "$METADATA_PATH"
}
BACKUP_CLEANUP_READY=1

OWNS_PARTIAL_ARCHIVE=1
pg_dump --dbname="$LIBPQ_DATABASE_URL" --format=custom --no-owner --no-privileges --file="$PARTIAL_ARCHIVE_PATH"
pg_restore --list "$PARTIAL_ARCHIVE_PATH" >/dev/null

ARCHIVE_SHA256="$(sha256sum "$PARTIAL_ARCHIVE_PATH" | awk '{print $1}')"
OWNS_PARTIAL_CHECKSUM=1
printf '%s  %s\n' "$ARCHIVE_SHA256" "$(basename "$ARCHIVE_PATH")" > "$PARTIAL_CHECKSUM_PATH"
OWNS_PARTIAL_METADATA=1
BACKUP_CREATED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
export BACKUP_CREATED_AT SERVER_VERSION_NUM ARCHIVE_SHA256 PG_DUMP_VERSION PG_RESTORE_VERSION ARCHIVE_NAME="$(basename "$ARCHIVE_PATH")"
node -e 'const fs=require("fs");const value={schemaVersion:1,createdAt:process.env.BACKUP_CREATED_AT,archiveName:process.env.ARCHIVE_NAME,archiveSha256:process.env.ARCHIVE_SHA256,database:{serverVersionNum:process.env.SERVER_VERSION_NUM},tools:{pgDump:process.env.PG_DUMP_VERSION,pgRestore:process.env.PG_RESTORE_VERSION}};fs.writeFileSync(process.argv[1],JSON.stringify(value,null,2)+"\n",{mode:0o600});' "$PARTIAL_METADATA_PATH"

mv "$PARTIAL_ARCHIVE_PATH" "$ARCHIVE_PATH"
OWNS_PARTIAL_ARCHIVE=0
OWNS_ARCHIVE=1
mv "$PARTIAL_METADATA_PATH" "$METADATA_PATH"
OWNS_PARTIAL_METADATA=0
OWNS_METADATA=1
mv "$PARTIAL_CHECKSUM_PATH" "$CHECKSUM_PATH"
OWNS_PARTIAL_CHECKSUM=0
OWNS_CHECKSUM=1

# The checksum is the final commit marker. Once present, published artifacts
# belong to retention rather than failure cleanup.
OWNS_ARCHIVE=0
OWNS_CHECKSUM=0
OWNS_METADATA=0

RETENTION_FIND_DAYS=$((BACKUP_RETENTION_DAYS - 1))
find "$BACKUP_DIR" -type f -name '*.dump' -mtime +"$RETENTION_FIND_DAYS" -delete
find "$BACKUP_DIR" -type f -name '*.dump.sha256' -mtime +"$RETENTION_FIND_DAYS" -delete
find "$BACKUP_DIR" -type f -name '*.dump.metadata.json' -mtime +"$RETENTION_FIND_DAYS" -delete

BACKUP_COMPLETED_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"
publish_attempt SUCCEEDED "$BACKUP_ATTEMPTED_AT" "$BACKUP_COMPLETED_AT" "$(basename "$ARCHIVE_PATH")" "$ARCHIVE_SHA256"
BACKUP_TERMINAL_PUBLISHED=1

echo "Backup written to $ARCHIVE_PATH"
echo "Checksum written to $CHECKSUM_PATH"
echo "Metadata written to $METADATA_PATH"
