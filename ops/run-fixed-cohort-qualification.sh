#!/bin/sh
set -eu

: "${FORMAL_ROUND:?set FORMAL_ROUND to 1 or 2}"
: "${IMAGE_TAG:?set IMAGE_TAG}"
: "${GITHUB_SHA:?set GITHUB_SHA}"
: "${GITHUB_RUN_ID:?set GITHUB_RUN_ID}"
: "${GITHUB_REPOSITORY:?set GITHUB_REPOSITORY}"

. "$PWD/ops/libpq-url.sh"

if [ "$FORMAL_ROUND" != 1 ] && [ "$FORMAL_ROUND" != 2 ]; then
  echo "FORMAL_ROUND must be 1 or 2" >&2
  exit 2
fi

work_root="$PWD/.runtime/formal-work"
state_root="$PWD/.runtime/formal-state"
runner_status_root="$PWD/.runtime/formal-runner-status"
input_root="$PWD/.runtime/formal-input"
qualification_root="$PWD/.runtime/formal-qualification-input"
network="job-finder-formal-${GITHUB_RUN_ID}"
postgres_name="job-finder-formal-postgres-${GITHUB_RUN_ID}"
database_url="postgresql://jobfinder:formal-qualification-password@postgres/jobfinder?schema=public"
libpq_database_url="$(normalize_libpq_database_url "$database_url")"
admin_email="qualification-owner@example.com"
admin_hash='scrypt$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
postgres_image='postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec'

mkdir -p "$work_root" "$state_root" "$qualification_root"
chmod 0777 "$work_root" "$state_root"
if [ -e "$runner_status_root" ] || [ -L "$runner_status_root" ]; then
  test -d "$runner_status_root"
  test ! -L "$runner_status_root"
else
  mkdir "$runner_status_root"
fi
chmod 0700 "$runner_status_root"
test "$(stat --format=%u -- "$runner_status_root")" = "$(id -u)"

if [ "$FORMAL_ROUND" = 1 ]; then
  runner_status_path="$runner_status_root/round-one-runner-status.json"
else
  runner_status_path="$runner_status_root/round-two-runner-status.json"
fi
runner_stage=INITIALIZING

write_runner_status() {
  status="$1"
  exit_code="$2"
  status_temp="$runner_status_path.partial"
  updated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || return 1
  printf '{"schemaVersion":1,"formalRound":%s,"status":"%s","stage":"%s","exitCode":%s,"updatedAt":"%s"}\n' \
    "$FORMAL_ROUND" "$status" "$runner_stage" "$exit_code" "$updated_at" > "$status_temp" || return 1
  chmod 0600 "$status_temp" || return 1
  mv -f "$status_temp" "$runner_status_path" || return 1
}

set_runner_stage() {
  runner_stage="$1"
  write_runner_status RUNNING 0
}

cleanup() {
  docker rm --force "$postgres_name" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}

on_exit() {
  exit_code="$1"
  trap - EXIT
  cleanup
  if [ "$exit_code" -eq 0 ]; then runner_status=PASSED; else runner_status=FAILED; fi
  rm -f -- "$runner_status_path" "$runner_status_path.partial"
  if ! write_runner_status "$runner_status" "$exit_code"; then
    echo "Failed to write formal qualification runner status" >&2
    rm -f -- "$runner_status_path" "$runner_status_path.partial"
    if [ "$exit_code" -eq 0 ]; then exit_code=1; fi
  fi
  exit "$exit_code"
}

trap 'on_exit $?' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
write_runner_status RUNNING 0

cp "$PWD/.runtime/image-qualification-receipt.json" "$qualification_root/image-qualification-receipt.json"
cp "$PWD/.runtime/security/production-security-receipt.json" "$qualification_root/production-security-receipt.json"
cp "$PWD/.runtime/restore/restore-pass-receipt.json" "$qualification_root/restore-pass-receipt.json"
chmod 0444 "$qualification_root/image-qualification-receipt.json" \
  "$qualification_root/production-security-receipt.json" "$qualification_root/restore-pass-receipt.json"

validate_regular_file_below_root() {
  root="$1"
  file="$2"
  test -d "$root" || return 1
  test ! -L "$root" || return 1
  root_real="$(realpath --canonicalize-existing "$root")" || return 1
  test ! -L "$file" || return 1
  test -f "$file" || return 1
  test "$(stat --format=%h -- "$file")" = 1 || return 1
  file_real="$(realpath --canonicalize-existing -- "$file")" || return 1
  case "$file_real" in "$root_real"/*) ;; *) return 1 ;; esac
}

normalize_owned_regular_file() {
  root="$1"
  file="$2"
  validate_regular_file_below_root "$root" "$file" || return 1
  file_real="$(realpath --canonicalize-existing -- "$file")" || return 1
  sudo chown --no-dereference -- "$(id -u):$(id -g)" "$file" || return 1
  validate_regular_file_below_root "$root" "$file" || return 1
  test "$(realpath --canonicalize-existing -- "$file")" = "$file_real" || return 1
  chmod 0600 -- "$file" || return 1
  test -r "$file" || return 1
}

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
  normalize_owned_regular_file "$root" "$file" || return 1
}

normalize_existing_formal_file() {
  file="$1"
  if [ ! -e "$file" ] && [ ! -L "$file" ]; then return 0; fi
  normalize_formal_file "$file" || return 1
}

resolve_final_backup_triplet() {
  backup_root="$1"
  final_archive_count="$(find "$backup_root" -maxdepth 1 -type f -name 'jobfinder-*.dump' | wc -l)" || return 1
  test "$final_archive_count" = 1 || return 1
  final_archive="$(find "$backup_root" -maxdepth 1 -type f -name 'jobfinder-*.dump' -print -quit)" || return 1
  final_archive_name="$(basename "$final_archive")" || return 1
  printf '%s\n' "$final_archive_name" | grep -Eq '^jobfinder-[0-9]{8}T[0-9]{6}Z\.dump$' || return 1
  validate_regular_file_below_root "$backup_root" "$final_archive" || return 1
  validate_regular_file_below_root "$backup_root" "$final_archive.sha256" || return 1
  validate_regular_file_below_root "$backup_root" "$final_archive.metadata.json" || return 1
}

validate_final_backup_inventory() {
  backup_root="$1"
  archive="$2"
  attempt_receipt="$backup_root/latest-backup-attempt.json"
  lock_file="$backup_root/.jobfinder-backup.lock"
  backup_entry_count="$(find "$backup_root" -mindepth 1 -maxdepth 1 -print | wc -l)" || return 1
  test "$backup_entry_count" = 5 || return 1
  validate_regular_file_below_root "$backup_root" "$archive" || return 1
  validate_regular_file_below_root "$backup_root" "$archive.sha256" || return 1
  validate_regular_file_below_root "$backup_root" "$archive.metadata.json" || return 1
  validate_regular_file_below_root "$backup_root" "$attempt_receipt" || return 1
  validate_regular_file_below_root "$backup_root" "$lock_file" || return 1
}

normalize_final_backup_known_files() {
  backup_root="$1"
  archive="$2"
  normalize_owned_regular_file "$backup_root" "$archive" || return 1
  normalize_owned_regular_file "$backup_root" "$archive.sha256" || return 1
  normalize_owned_regular_file "$backup_root" "$archive.metadata.json" || return 1
  normalize_owned_regular_file "$backup_root" "$backup_root/latest-backup-attempt.json" || return 1
  normalize_owned_regular_file "$backup_root" "$backup_root/.jobfinder-backup.lock" || return 1
}

finalize_final_backup_evidence() {
  backup_root="$1"
  archive="$2"
  validate_final_backup_inventory "$backup_root" "$archive" || return 1
  normalize_final_backup_known_files "$backup_root" "$archive" || return 1
  validate_final_backup_inventory "$backup_root" "$archive" || return 1
  chmod 0700 "$backup_root" || return 1
  test "$(stat --format=%u -- "$backup_root")" = "$(id -u)" || return 1
}

ensure_failure_backup_evidence_root() {
  failure_backup_root="$state_root/final-backup-failure-evidence"
  if [ -e "$failure_backup_root" ] || [ -L "$failure_backup_root" ]; then
    test -d "$failure_backup_root" || return 1
    test ! -L "$failure_backup_root" || return 1
    test "$(stat --format=%u -- "$failure_backup_root")" = "$(id -u)" || return 1
  else
    mkdir "$failure_backup_root" || return 1
  fi
  chmod 0700 "$failure_backup_root" || return 1
}

stage_final_backup_attempt_failure_evidence() {
  backup_root="$1"
  attempt_receipt="$backup_root/latest-backup-attempt.json"
  normalize_owned_regular_file "$backup_root" "$attempt_receipt" || return 1
  ensure_failure_backup_evidence_root || return 1
  cp -- "$attempt_receipt" "$failure_backup_root/latest-backup-attempt.json" || return 1
  chmod 0600 "$failure_backup_root/latest-backup-attempt.json" || return 1
}

stage_final_backup_failure_evidence() {
  backup_root="$1"
  archive="$2"
  validate_regular_file_below_root "$backup_root" "$archive" || return 1
  validate_regular_file_below_root "$backup_root" "$archive.sha256" || return 1
  validate_regular_file_below_root "$backup_root" "$archive.metadata.json" || return 1
  ensure_failure_backup_evidence_root || return 1
  cp -- "$archive" "$archive.sha256" "$archive.metadata.json" "$failure_backup_root/" || return 1
  chmod 0600 "$failure_backup_root/$(basename "$archive")" \
    "$failure_backup_root/$(basename "$archive").sha256" \
    "$failure_backup_root/$(basename "$archive").metadata.json" || return 1
}

snapshot_round_two_audit() {
  audit_path="$work_root/round-two-audit.json"
  if [ ! -e "$audit_path" ] && [ ! -L "$audit_path" ]; then return 0; fi
  normalize_formal_file "$audit_path" || return 1
  cp "$audit_path" "$state_root/round-two-audit.json" || return 1
  chmod 0600 "$state_root/round-two-audit.json" || return 1
  chmod 0444 "$audit_path" || return 1
}

preserve_round_two_failure_evidence() {
  round_two_preserve_exit=0
  normalize_existing_formal_file "$work_root/round-two-audit.json" || round_two_preserve_exit=1
  normalize_existing_formal_file "$state_root/final-restore-receipt.json" || round_two_preserve_exit=1
  normalize_existing_formal_file "$state_root/final-image-qualification-receipt.json" || round_two_preserve_exit=1
  normalize_existing_formal_file "$state_root/final-database-backup.tar.gz" || round_two_preserve_exit=1
  normalize_existing_formal_file "$state_root/launch-receipt.json" || round_two_preserve_exit=1
  normalize_existing_formal_file "$state_root/round-two-evidence.tar.gz" || round_two_preserve_exit=1
  if [ -f "$work_root/round-two-audit.json" ] && [ ! -L "$work_root/round-two-audit.json" ]; then
    cp "$work_root/round-two-audit.json" "$state_root/round-two-audit.json" || round_two_preserve_exit=1
    chmod 0600 "$state_root/round-two-audit.json" || round_two_preserve_exit=1
  fi
  cp "$qualification_root/production-security-receipt.json" \
    "$state_root/production-security-receipt.json" || round_two_preserve_exit=1
  chmod 0600 "$state_root/production-security-receipt.json" || round_two_preserve_exit=1
  if [ -n "${final_backup_root:-}" ] && \
    { [ -e "$final_backup_root/latest-backup-attempt.json" ] || \
      [ -L "$final_backup_root/latest-backup-attempt.json" ]; }; then
    stage_final_backup_attempt_failure_evidence "$final_backup_root" || round_two_preserve_exit=1
  fi
  if [ -n "${final_archive:-}" ]; then
    stage_final_backup_failure_evidence "$final_backup_root" "$final_archive" || round_two_preserve_exit=1
  fi
  return "$round_two_preserve_exit"
}

finalize_round_two_success_evidence() {
  normalize_formal_file "$work_root/round-two-audit.json" || return 1
  normalize_formal_file "$state_root/final-restore-receipt.json" || return 1
  normalize_formal_file "$state_root/final-image-qualification-receipt.json" || return 1
  normalize_formal_file "$state_root/final-database-backup.tar.gz" || return 1
  normalize_formal_file "$state_root/launch-receipt.json" || return 1
  normalize_formal_file "$state_root/round-two-evidence.tar.gz" || return 1
  cp "$work_root/round-two-audit.json" "$state_root/round-two-audit.json" || return 1
  cp "$qualification_root/production-security-receipt.json" \
    "$state_root/production-security-receipt.json" || return 1
  chmod 0600 "$state_root/round-two-audit.json" \
    "$state_root/production-security-receipt.json" || return 1
}

stop_round_two_with_preserved_evidence() {
  original_exit="$1"
  preservation_exit=0
  preserve_round_two_failure_evidence || preservation_exit=$?
  if [ "$original_exit" -ne 0 ]; then exit "$original_exit"; fi
  exit "$preservation_exit"
}

run_image() {
  docker run --rm --network "$network" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=1g,mode=1777 \
    --shm-size 1g --env DATABASE_URL="$database_url" --env ADMIN_EMAIL="$admin_email" \
    --env ADMIN_PASSWORD_HASH="$admin_hash" "$IMAGE_TAG" "$@"
}

set_runner_stage POSTGRES_START
docker network create "$network" >/dev/null
docker run --detach --name "$postgres_name" --network "$network" --network-alias postgres \
  --env POSTGRES_DB=jobfinder --env POSTGRES_USER=jobfinder \
  --env POSTGRES_PASSWORD=formal-qualification-password "$postgres_image" >/dev/null
set_runner_stage POSTGRES_INTERNAL_READY
postgres_ready=0
for attempt in $(seq 1 60); do
  if docker exec "$postgres_name" pg_isready -U jobfinder -d jobfinder >/dev/null; then postgres_ready=1; break; fi
  sleep 1
done
test "$postgres_ready" = 1

set_runner_stage POSTGRES_NETWORK_READY
postgres_network_ready=0
for attempt in $(seq 1 60); do
  if postgres_network_probe="$(run_image psql --no-psqlrc --dbname="$libpq_database_url" \
    --tuples-only --no-align --command='SELECT 1')"; then
    if [ "$postgres_network_probe" = 1 ]; then
      postgres_network_ready=1
      break
    fi
  fi
  sleep 1
done
test "$postgres_network_ready" = 1

run_crawl() {
  docker run --rm --init --network "$network" --read-only --cap-drop ALL \
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
    --volume "$state_root:/state" "$IMAGE_TAG" pg_dump --dbname="$libpq_database_url" \
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
  set_runner_stage ROUND_ONE_BOOTSTRAP
  run_image node node_modules/tsx/dist/cli.mjs scripts/ops-bootstrap.ts
  set_runner_stage ROUND_ONE_SNAPSHOT
  dump_database initial-migrated.dump
  normalize_formal_file "$state_root/initial-migrated.dump"
  db_snapshot_sha256="$(sha256sum "$state_root/initial-migrated.dump" | awk '{print $1}')"
  migration_json="$(docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    "$IMAGE_TAG" node node_modules/tsx/dist/cli.mjs -e \
    "import { listCurrentPrismaMigrations, prismaMigrationManifestSha256 } from './src/db/prismaMigrationManifest.ts'; const rows=listCurrentPrismaMigrations('/app'); process.stdout.write(JSON.stringify({schemaSha256:prismaMigrationManifestSha256(rows),migrationVersion:rows.at(-1)?.migrationName??''}));")"
  schema_sha256="$(node -p "JSON.parse(process.argv[1]).schemaSha256" "$migration_json")"
  migration_version="$(node -p "JSON.parse(process.argv[1]).migrationVersion" "$migration_json")"
  release_candidate_id="p0-launch-$(printf '%s' "$GITHUB_SHA" | cut -c1-12)"
  run_image node node_modules/tsx/dist/cli.mjs scripts/p0-staged-release-candidate.ts prepare \
    --id "$release_candidate_id" --goal-id launch-ready --version 1 \
    --db-snapshot-sha256 "$db_snapshot_sha256" --schema-sha256 "$schema_sha256" \
    --migration-version "$migration_version"

  set_runner_stage ROUND_ONE_CRAWL
  crawl_exit=0
  run_crawl || crawl_exit=$?
  audit_exit=0
  set_runner_stage ROUND_ONE_AUDIT
  run_audit round-one-audit.json || audit_exit=$?
  dump_database round-one.dump
  archive_evidence round-one-evidence.tar.gz
  set_runner_stage ROUND_ONE_STATE_CAPTURE
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
  docker save "$IMAGE_TAG" | gzip -1 > "$state_root/round-one-qualified-image.tar.gz"
  chmod 0600 "$state_root/round-one-audit.json" "$state_root/round-one-image-qualification-receipt.json" \
    "$state_root/round-one-qualified-image.tar.gz"
  decision="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).decision" \
    "$state_root/round-one-state-receipt.json")"
  test "$crawl_exit" -eq 0
  test "$audit_exit" -eq 0
  test "$decision" = ROUND_ONE_QUALIFIED
else
  set_runner_stage ROUND_TWO_RESTORE
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
    "$IMAGE_TAG" pg_restore --dbname="$libpq_database_url" --no-owner --no-privileges /round-one/round-one.dump
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

  set_runner_stage ROUND_TWO_CRAWL
  crawl_exit=0
  run_crawl || crawl_exit=$?
  audit_exit=0
  set_runner_stage ROUND_TWO_AUDIT
  run_audit round-two-audit.json || audit_exit=$?
  round_two_audit_snapshot_exit=0
  snapshot_round_two_audit || round_two_audit_snapshot_exit=$?
  if [ "$round_two_audit_snapshot_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$round_two_audit_snapshot_exit"
  fi
  round_two_evidence_archive_exit=0
  archive_evidence round-two-evidence.tar.gz || round_two_evidence_archive_exit=$?
  if [ "$round_two_evidence_archive_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$round_two_evidence_archive_exit"
  fi
  final_backup_root="$state_root/final-backup"
  final_backup_setup_exit=0
  mkdir -p "$final_backup_root" || final_backup_setup_exit=$?
  if [ "$final_backup_setup_exit" -eq 0 ]; then
    chmod 0777 "$final_backup_root" || final_backup_setup_exit=$?
  fi
  if [ "$final_backup_setup_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$final_backup_setup_exit"
  fi
  final_backup_producer_exit=0
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --env DATABASE_URL="$database_url" \
    --env BACKUP_DIR=/state/final-backup --env BACKUP_RETENTION_DAYS=14 \
    --volume "$state_root:/state" "$IMAGE_TAG" sh ./ops/backup.sh || final_backup_producer_exit=$?
  if [ "$final_backup_producer_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$final_backup_producer_exit"
  fi
  final_backup_resolution_exit=0
  resolve_final_backup_triplet "$final_backup_root" || final_backup_resolution_exit=$?
  if [ "$final_backup_resolution_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$final_backup_resolution_exit"
  fi
  final_backup_inventory_exit=0
  validate_final_backup_inventory "$final_backup_root" "$final_archive" || final_backup_inventory_exit=$?
  if [ "$final_backup_inventory_exit" -ne 0 ]; then
    final_backup_normalization_exit=0
    normalize_final_backup_known_files "$final_backup_root" "$final_archive" || final_backup_normalization_exit=$?
    if [ "$final_backup_normalization_exit" -ne 0 ]; then
      stop_round_two_with_preserved_evidence "$final_backup_normalization_exit"
    fi
    stop_round_two_with_preserved_evidence "$final_backup_inventory_exit"
  fi
  restore_qualification_exit=0
  docker run --rm --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 \
    --env RESTORE_ADMIN_DATABASE_URL="postgresql://jobfinder:formal-qualification-password@postgres/postgres" \
    --env RESTORE_RECEIPT_PATH=/state/final-restore-receipt.json --volume "$state_root:/state" "$IMAGE_TAG" \
    node node_modules/tsx/dist/cli.mjs scripts/qualify-backup-restore.ts "/state/final-backup/$final_archive_name" \
    || restore_qualification_exit=$?
  if [ "$restore_qualification_exit" -eq 0 ]; then
    restore_database_count="$(docker exec "$postgres_name" psql -U jobfinder -d postgres -Atc \
      "SELECT count(*) FROM pg_database WHERE left(datname, 18) = 'jobfinder_restore_'")" \
      || restore_qualification_exit=$?
    if [ "$restore_qualification_exit" -eq 0 ] && [ "$restore_database_count" != 0 ]; then
      restore_qualification_exit=1
    fi
  fi
  final_backup_archive_exit=0
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --volume "$state_root:/state" "$IMAGE_TAG" \
    tar -czf /state/final-database-backup.tar.gz -C /state/final-backup \
    "$final_archive_name" "$final_archive_name.sha256" "$final_archive_name.metadata.json" \
    || final_backup_archive_exit=$?
  final_backup_finalize_exit=0
  finalize_final_backup_evidence "$final_backup_root" "$final_archive" || final_backup_finalize_exit=$?
  if [ "$restore_qualification_exit" -ne 0 ] || [ "$final_backup_archive_exit" -ne 0 ] || \
    [ "$final_backup_finalize_exit" -ne 0 ]; then
    if [ "$restore_qualification_exit" -ne 0 ]; then
      stop_round_two_with_preserved_evidence "$restore_qualification_exit"
    fi
    if [ "$final_backup_archive_exit" -ne 0 ]; then
      stop_round_two_with_preserved_evidence "$final_backup_archive_exit"
    fi
    stop_round_two_with_preserved_evidence "$final_backup_finalize_exit"
  fi
  image_digest_exit=0
  image_digest="$(docker image inspect --format '{{.Id}}' "$IMAGE_TAG")" || image_digest_exit=$?
  if [ "$image_digest_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$image_digest_exit"
  fi
  final_image_receipt_exit=0
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,mode=1777 --volume "$state_root:/state" \
    --volume "$qualification_root:/qualification:ro" "$IMAGE_TAG" node node_modules/tsx/dist/cli.mjs \
    scripts/write-image-qualification-receipt.ts /state/final-image-qualification-receipt.json \
    "$image_digest" "$GITHUB_SHA" /app/build-identity.json /qualification/production-security-receipt.json \
    /state/final-restore-receipt.json || final_image_receipt_exit=$?
  if [ "$final_image_receipt_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$final_image_receipt_exit"
  fi
  set_runner_stage ROUND_TWO_LAUNCH_RECEIPT
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
  if [ "$launch_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$launch_exit"
  fi
  round_two_success_evidence_exit=0
  finalize_round_two_success_evidence || round_two_success_evidence_exit=$?
  if [ "$round_two_success_evidence_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$round_two_success_evidence_exit"
  fi
  launch_decision_exit=0
  launch_decision="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).decision" \
    "$state_root/launch-receipt.json")" || launch_decision_exit=$?
  if [ "$launch_decision_exit" -ne 0 ]; then
    stop_round_two_with_preserved_evidence "$launch_decision_exit"
  fi
  if [ "$crawl_exit" -ne 0 ]; then stop_round_two_with_preserved_evidence "$crawl_exit"; fi
  if [ "$audit_exit" -ne 0 ]; then stop_round_two_with_preserved_evidence "$audit_exit"; fi
  if [ "$launch_decision" != READY ]; then stop_round_two_with_preserved_evidence 1; fi
fi
