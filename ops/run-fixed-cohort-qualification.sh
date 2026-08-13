#!/bin/sh
set -eu

: "${FORMAL_ROUND:?set FORMAL_ROUND to 1 or 2}"
: "${IMAGE_TAG:?set IMAGE_TAG}"
: "${GITHUB_SHA:?set GITHUB_SHA}"
: "${GITHUB_RUN_ID:?set GITHUB_RUN_ID}"
: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}"

if [ "$FORMAL_ROUND" != 1 ] && [ "$FORMAL_ROUND" != 2 ]; then
  echo "FORMAL_ROUND must be 1 or 2" >&2
  exit 2
fi

work_root="$PWD/.runtime/formal-work"
state_root="$PWD/.runtime/formal-state"
input_root="$PWD/.runtime/formal-input"
qualification_root="$PWD/.runtime/formal-qualification-input"
network="job-finder-formal-${GITHUB_RUN_ID}"
postgres_name="job-finder-formal-postgres-${GITHUB_RUN_ID}"
database_url="postgresql://jobfinder:formal-qualification-password@postgres/jobfinder?schema=public"
admin_email="qualification-owner@example.com"
admin_hash='scrypt$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
postgres_image='postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec'

mkdir -p "$work_root" "$state_root" "$qualification_root"
chmod 0777 "$work_root" "$state_root"
if [ "$FORMAL_ROUND" = 2 ]; then
  for exact_image_file in round-one-qualified-image.tar.gz round-one-image-qualification-receipt.json \
    round-one-production-security-receipt.json round-one-restore-receipt.json; do
    test ! -L "$input_root/$exact_image_file"
    test -f "$input_root/$exact_image_file"
    test "$(stat --format=%h -- "$input_root/$exact_image_file")" = 1
    chmod 0444 "$input_root/$exact_image_file"
  done
  gunzip --stdout "$input_root/round-one-qualified-image.tar.gz" | docker load >/dev/null
  expected_image_digest="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).imageDigest" \
    "$input_root/round-one-image-qualification-receipt.json")"
  test "$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")" = "$expected_image_digest"
  cp "$input_root/round-one-image-qualification-receipt.json" "$qualification_root/image-qualification-receipt.json"
  cp "$input_root/round-one-production-security-receipt.json" "$qualification_root/production-security-receipt.json"
  cp "$input_root/round-one-restore-receipt.json" "$qualification_root/restore-pass-receipt.json"
else
  cp "$PWD/.runtime/image-qualification-receipt.json" "$qualification_root/image-qualification-receipt.json"
  cp "$PWD/.runtime/security/production-security-receipt.json" "$qualification_root/production-security-receipt.json"
  cp "$PWD/.runtime/restore/restore-pass-receipt.json" "$qualification_root/restore-pass-receipt.json"
fi
chmod 0444 "$qualification_root/image-qualification-receipt.json" \
  "$qualification_root/production-security-receipt.json" "$qualification_root/restore-pass-receipt.json"

normalize_formal_file() {
  file="$1"
  case "$file" in
    "$work_root/round-one-audit.json"|"$work_root/round-two-audit.json"|\
    "$state_root/initial-migrated.dump"|\
    "$state_root/round-one.dump"|"$state_root/round-two.dump"|\
    "$state_root/round-one-state-receipt.json"|"$state_root/launch-receipt.json"|\
    "$state_root/final-restore-receipt.json"|"$state_root/final-image-qualification-receipt.json"|\
    "$state_root/final-database-backup.tar.gz"|\
    "$state_root/round-one-evidence.tar.gz"|"$state_root/round-two-evidence.tar.gz") ;;
    *) return 1 ;;
  esac
  root="$work_root"
  case "$file" in "$state_root"/*) root="$state_root" ;; esac
  root_real="$(realpath --canonicalize-existing "$root")"
  test ! -L "$file"
  test -f "$file"
  test "$(stat --format=%h -- "$file")" = 1
  file_real="$(realpath --canonicalize-existing -- "$file")"
  case "$file_real" in "$root_real"/*) ;; *) return 1 ;; esac
  sudo chown --no-dereference -- "$(id -u):$(id -g)" "$file"
  test ! -L "$file"
  test -f "$file"
  test "$(stat --format=%h -- "$file")" = 1
  test "$(realpath --canonicalize-existing -- "$file")" = "$file_real"
  chmod 0600 -- "$file"
  test -r "$file"
}

cleanup() {
  docker rm --force "$postgres_name" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker network create "$network" >/dev/null
docker run --detach --name "$postgres_name" --network "$network" --network-alias postgres \
  --env POSTGRES_DB=jobfinder --env POSTGRES_USER=jobfinder \
  --env POSTGRES_PASSWORD=formal-qualification-password "$postgres_image" >/dev/null
postgres_ready=0
for attempt in $(seq 1 60); do
  if docker exec "$postgres_name" pg_isready -U jobfinder -d jobfinder >/dev/null; then postgres_ready=1; break; fi
  sleep 1
done
test "$postgres_ready" = 1

run_image() {
  docker run --rm --network "$network" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=1g,mode=1777 \
    --shm-size 1g --env DATABASE_URL="$database_url" --env ADMIN_EMAIL="$admin_email" \
    --env ADMIN_PASSWORD_HASH="$admin_hash" "$IMAGE_TAG" "$@"
}

run_crawl() {
  docker run --rm --network "$network" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=1g,mode=1777 \
    --shm-size 1g --env DATABASE_URL="$database_url" \
    --env P0_SCHEDULED_ATTEMPT_TIMEOUT_MS=14400000 \
    --env STAGED_CRAWL_SUMMARY_PATH=/app/outputs/staged-crawl-summary.json \
    --env STAGED_CRAWL_ATTEMPT_DIR=/app/outputs/staged-crawl-attempts \
    --env STAGED_INITIAL_QUALIFICATION_PAUSE_PATH=/app/outputs/staged-initial-qualification-pause.json \
    --volume "$work_root:/app/outputs" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-staged-crawl.ts --force
}

run_audit() {
  output_name="$1"
  docker run --rm --network "$network" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env DATABASE_URL="$database_url" --env FIXED_COHORT_AUDIT_PATH="/app/outputs/$output_name" \
    --volume "$work_root:/app/outputs" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-fixed-cohort-audit.ts
}

dump_database() {
  output_name="$1"
  docker run --rm --network "$network" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --volume "$state_root:/state" "$IMAGE_TAG" pg_dump --dbname="$database_url" \
    --format=custom --compress=6 --no-owner --no-privileges --file="/state/$output_name"
}

archive_evidence() {
  output_name="$1"
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --volume "$work_root:/evidence:ro" --volume "$state_root:/state" "$IMAGE_TAG" \
    tar -czf "/state/$output_name" -C /evidence .
}

if [ "$FORMAL_ROUND" = 1 ]; then
  run_image node node_modules/tsx/dist/cli.mjs scripts/ops-bootstrap.ts
  dump_database initial-migrated.dump
  normalize_formal_file "$state_root/initial-migrated.dump"
  db_snapshot_sha256="$(sha256sum "$state_root/initial-migrated.dump" | awk '{print $1}')"
  migration_json="$(docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true "$IMAGE_TAG" node node_modules/tsx/dist/cli.mjs -e \
    "import { listCurrentPrismaMigrations, prismaMigrationManifestSha256 } from './src/db/prismaMigrationManifest.ts'; const rows=listCurrentPrismaMigrations('/app'); process.stdout.write(JSON.stringify({schemaSha256:prismaMigrationManifestSha256(rows),migrationVersion:rows.at(-1)?.migrationName??''}));")"
  schema_sha256="$(printf '%s' "$migration_json" | jq -er '.schemaSha256')"
  migration_version="$(printf '%s' "$migration_json" | jq -er '.migrationVersion')"
  release_candidate_id="p0-launch-$(printf '%s' "$GITHUB_SHA" | cut -c1-12)"
  run_image node node_modules/tsx/dist/cli.mjs scripts/p0-staged-release-candidate.ts prepare \
    --id "$release_candidate_id" --goal-id launch-ready --version 1 \
    --db-snapshot-sha256 "$db_snapshot_sha256" --schema-sha256 "$schema_sha256" \
    --migration-version "$migration_version"

  crawl_exit=0
  run_crawl || crawl_exit=$?
  audit_exit=0
  run_audit round-one-audit.json || audit_exit=$?
  dump_database round-one.dump
  archive_evidence round-one-evidence.tar.gz
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env DATABASE_URL="$database_url" --env GITHUB_REPOSITORY="$GITHUB_REPOSITORY" \
    --env GITHUB_RUN_ID="$GITHUB_RUN_ID" --env GITHUB_SHA="$GITHUB_SHA" \
    --volume "$state_root:/state" --volume "$work_root:/evidence:ro" \
    --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-formal-qualification-state.ts capture \
    --archive /state/round-one.dump --audit /evidence/round-one-audit.json \
    --evidence-archive /state/round-one-evidence.tar.gz \
    --current-image-qualification /qualification/image-qualification-receipt.json \
    --receipt /state/round-one-state-receipt.json
  normalize_formal_file "$work_root/round-one-audit.json"
  normalize_formal_file "$state_root/round-one.dump"
  normalize_formal_file "$state_root/round-one-state-receipt.json"
  normalize_formal_file "$state_root/round-one-evidence.tar.gz"
  cp "$work_root/round-one-audit.json" "$state_root/round-one-audit.json"
  cp "$qualification_root/image-qualification-receipt.json" "$state_root/round-one-image-qualification-receipt.json"
  cp "$qualification_root/production-security-receipt.json" "$state_root/round-one-production-security-receipt.json"
  cp "$qualification_root/restore-pass-receipt.json" "$state_root/round-one-restore-receipt.json"
  docker save "$IMAGE_TAG" | gzip -1 > "$state_root/round-one-qualified-image.tar.gz"
  chmod 0600 "$state_root/round-one-audit.json" "$state_root/round-one-image-qualification-receipt.json" \
    "$state_root/round-one-production-security-receipt.json" "$state_root/round-one-restore-receipt.json" \
    "$state_root/round-one-qualified-image.tar.gz"
  decision="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).decision" \
    "$state_root/round-one-state-receipt.json")"
  test "$crawl_exit" -eq 0
  test "$audit_exit" -eq 0
  test "$decision" = ROUND_ONE_QUALIFIED
else
  : "${ROUND_ONE_RUN_ID:?set ROUND_ONE_RUN_ID for round two}"
  test -d "$input_root"
  for input_file in round-one.dump round-one-audit.json round-one-evidence.tar.gz \
    round-one-image-qualification-receipt.json round-one-state-receipt.json; do
    test ! -L "$input_root/$input_file"
    test -f "$input_root/$input_file"
    test "$(stat --format=%h -- "$input_root/$input_file")" = 1
    chmod 0444 "$input_root/$input_file"
  done
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env GITHUB_REPOSITORY="$GITHUB_REPOSITORY" --env GITHUB_SHA="$GITHUB_SHA" \
    --volume "$input_root:/round-one:ro" --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-formal-qualification-state.ts verify-files \
    --archive /round-one/round-one.dump --audit /round-one/round-one-audit.json \
    --evidence-archive /round-one/round-one-evidence.tar.gz \
    --round-one-image-qualification /round-one/round-one-image-qualification-receipt.json \
    --current-image-qualification /qualification/image-qualification-receipt.json \
    --receipt /round-one/round-one-state-receipt.json --round-one-run-id "$ROUND_ONE_RUN_ID"
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --volume "$input_root:/round-one:ro" \
    "$IMAGE_TAG" pg_restore --dbname="$database_url" --no-owner --no-privileges /round-one/round-one.dump
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --env DATABASE_URL="$database_url" \
    --env GITHUB_REPOSITORY="$GITHUB_REPOSITORY" --env GITHUB_SHA="$GITHUB_SHA" \
    --volume "$input_root:/round-one:ro" --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-formal-qualification-state.ts verify-restored \
    --archive /round-one/round-one.dump --audit /round-one/round-one-audit.json \
    --evidence-archive /round-one/round-one-evidence.tar.gz \
    --round-one-image-qualification /round-one/round-one-image-qualification-receipt.json \
    --current-image-qualification /qualification/image-qualification-receipt.json \
    --receipt /round-one/round-one-state-receipt.json --round-one-run-id "$ROUND_ONE_RUN_ID"
  for input_file in round-one.dump round-one-audit.json round-one-evidence.tar.gz \
    round-one-image-qualification-receipt.json round-one-state-receipt.json; do
    cp "$input_root/$input_file" "$state_root/$input_file"
    chmod 0600 "$state_root/$input_file"
  done

  crawl_exit=0
  run_crawl || crawl_exit=$?
  audit_exit=0
  run_audit round-two-audit.json || audit_exit=$?
  archive_evidence round-two-evidence.tar.gz
  final_backup_root="$state_root/final-backup"
  mkdir -p "$final_backup_root"
  chmod 0777 "$final_backup_root"
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --env DATABASE_URL="$database_url" \
    --env BACKUP_DIR=/state/final-backup --env BACKUP_RETENTION_DAYS=14 \
    --volume "$state_root:/state" "$IMAGE_TAG" sh ./ops/backup.sh
  final_archive_count="$(find "$final_backup_root" -maxdepth 1 -type f -name 'jobfinder-*.dump' | wc -l)"
  test "$final_archive_count" = 1
  final_archive="$(find "$final_backup_root" -maxdepth 1 -type f -name 'jobfinder-*.dump' -print -quit)"
  final_archive_name="$(basename "$final_archive")"
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env RESTORE_ADMIN_DATABASE_URL="postgresql://jobfinder:formal-qualification-password@postgres/postgres" \
    --env RESTORE_RECEIPT_PATH=/state/final-restore-receipt.json --volume "$state_root:/state" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/qualify-backup-restore.ts "/state/final-backup/$final_archive_name"
  restore_database_count="$(docker exec "$postgres_name" psql -U jobfinder -d postgres -Atc \
    "SELECT count(*) FROM pg_database WHERE left(datname, 18) = 'jobfinder_restore_'")"
  test "$restore_database_count" = 0
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --volume "$state_root:/state" "$IMAGE_TAG" \
    tar -czf /state/final-database-backup.tar.gz -C /state/final-backup .
  image_digest="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")"
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --volume "$state_root:/state" \
    --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" node node_modules/tsx/dist/cli.mjs \
    scripts/write-image-qualification-receipt.ts /state/final-image-qualification-receipt.json \
    "$image_digest" "$GITHUB_SHA" /app/build-identity.json /qualification/production-security-receipt.json \
    /state/final-restore-receipt.json
  launch_exit=0
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env DATABASE_URL="$database_url" --env ADMIN_EMAIL="$admin_email" --env ADMIN_PASSWORD_HASH="$admin_hash" \
    --env LAUNCH_RECEIPT_PATH=/state/launch-receipt.json \
    --env IMAGE_QUALIFICATION_RECEIPT_PATH=/state/final-image-qualification-receipt.json \
    --env PRODUCTION_SECURITY_RECEIPT_PATH=/qualification/production-security-receipt.json \
    --env RESTORE_RECEIPT_PATH=/state/final-restore-receipt.json \
    --env FORMAL_ROUND_ONE_STATE_RECEIPT_PATH=/round-one/round-one-state-receipt.json \
    --env FORMAL_ROUND_ONE_AUDIT_PATH=/round-one/round-one-audit.json \
    --env FORMAL_ROUND_ONE_EVIDENCE_ARCHIVE_PATH=/round-one/round-one-evidence.tar.gz \
    --env FORMAL_ROUND_ONE_DATABASE_ARCHIVE_PATH=/round-one/round-one.dump \
    --env FORMAL_ROUND_TWO_AUDIT_PATH=/evidence/round-two-audit.json \
    --env FORMAL_ROUND_TWO_EVIDENCE_ARCHIVE_PATH=/state/round-two-evidence.tar.gz \
    --volume "$state_root:/state" --volume "$input_root:/round-one:ro" --volume "$work_root:/evidence:ro" \
    --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/p0-authoritative-launch-receipt.ts || launch_exit=$?
  normalize_formal_file "$work_root/round-two-audit.json"
  normalize_formal_file "$state_root/final-restore-receipt.json"
  normalize_formal_file "$state_root/final-image-qualification-receipt.json"
  normalize_formal_file "$state_root/final-database-backup.tar.gz"
  normalize_formal_file "$state_root/launch-receipt.json"
  normalize_formal_file "$state_root/round-two-evidence.tar.gz"
  cp "$work_root/round-two-audit.json" "$state_root/round-two-audit.json"
  cp "$qualification_root/production-security-receipt.json" "$state_root/production-security-receipt.json"
  chmod 0600 "$state_root/round-two-audit.json" "$state_root/production-security-receipt.json"
  launch_decision="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).decision" \
    "$state_root/launch-receipt.json")"
  test "$crawl_exit" -eq 0
  test "$audit_exit" -eq 0
  test "$launch_exit" -eq 0
  test "$launch_decision" = READY
fi
