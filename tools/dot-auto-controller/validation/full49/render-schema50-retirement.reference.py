"""Render review-only canonical schema50 + honest ledger + v75 retirement, one transaction. No DB access."""
import argparse
import hashlib
import json
import pathlib
import re
from datetime import datetime

TARGET = 'dot-cloud-native-d02f4f5-20261011'
COMMIT = 'd02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f'
GOAL = 'jobfinder-portable-required-40'
FIELDS = ('id goalId version commitSha dbSnapshotHash schemaHash migrationVersion '
          'rosterHash sourcePlanHash sourceConfigHash adapterBundleHash oracleVersion '
          'status createdAt finalizedAt sourceTreeHash runtimeTreeHash '
          'minimumStableCompanyCount releaseQaEvidenceSha256').split()
FUNCTION = 'guard_v75_retired_source_publication'
TRIGGER = 'CrawlBatchSourceResult_v75_retired_candidate_guard'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def validate_expected(row):
    if set(row) != set(FIELDS):
        raise ValueError('Full 19-field ReleaseCandidate tuple required; no inferred values')
    if (row['id'], row['goalId'], row['version'], row['commitSha'], row['status']) != (
            TARGET, GOAL, 75, COMMIT, 'BUILDING'):
        raise ValueError('Exact reviewed v75 BUILDING identity required')
    if row['finalizedAt'] is not None or row['releaseQaEvidenceSha256'] is not None:
        raise ValueError('Unexpected existing finalization or QA evidence')
    if type(row['minimumStableCompanyCount']) is not int or row['minimumStableCompanyCount'] <= 0:
        raise ValueError('Invalid qualification threshold')
    for key in FIELDS:
        if key not in ('version', 'minimumStableCompanyCount', 'finalizedAt', 'releaseQaEvidenceSha256'):
            if not isinstance(row[key], str) or not row[key] or '\x00' in row[key]:
                raise ValueError('Invalid expected field: ' + key)
    for key in ('dbSnapshotHash','schemaHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash'):
        if not re.fullmatch(r'[a-f0-9]{64}',row[key]): raise ValueError('Invalid hash: '+key)
    if not re.fullmatch(r'[0-9]{14}_[a-z0-9_]+',row['migrationVersion']): raise ValueError('Invalid migration version')
    if not re.fullmatch(r'[A-Za-z0-9._-]+',row['oracleVersion']): raise ValueError('Invalid oracle version')
    if not re.fullmatch(r'[0-9TtZz:+. -]+',row['createdAt']): raise ValueError('Invalid creation timestamp')
    datetime.fromisoformat(row['createdAt'].replace('Z','+00:00'))
    if any(isinstance(value,str) and '$' in value for value in row.values()): raise ValueError('Unsafe dollar delimiter')
    return row


MIGRATION_NAME = '20261014141000_v75_retired_candidate_fence'
PACKAGE = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = PACKAGE/'vendor/c60-source/prisma/migrations'

DDL_SHA256 = 'b7c868b224ce1f13789f6f2cdcebafe95f1b2d83da1ac037d9a298cff79e3284'

def guard_ddl():
    data = (MIGRATIONS/MIGRATION_NAME/'migration.sql').read_bytes()
    if hashlib.sha256(data).hexdigest() != DDL_SHA256: raise ValueError('Canonical migration50 DDL drift')
    return data.decode('utf-8')

def registration_preflight():
    prior = [{'migrationName':p.parent.name,'checksum':hashlib.sha256(p.read_bytes()).hexdigest()}
             for p in sorted(MIGRATIONS.glob('*/migration.sql')) if p.parent.name != MIGRATION_NAME]
    if len(prior) != 49 or hashlib.sha256(json.dumps(prior,separators=(',',':')).encode()).hexdigest() != '91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a':
        raise ValueError('Canonical prior49 history changed')
    expected = literal(json.dumps(prior,separators=(',',':')))
    return f'''DO $schema50_history$
BEGIN
 LOCK TABLE public."_prisma_migrations" IN SHARE ROW EXCLUSIVE MODE;
 IF (SELECT count(*) FROM public."_prisma_migrations") <> 49 OR
    (SELECT count(DISTINCT migration_name) FROM public."_prisma_migrations") <> 49 OR EXISTS (
 SELECT 1 FROM public."_prisma_migrations" m FULL JOIN jsonb_to_recordset({expected}::jsonb)
 e("migrationName" text,checksum text) ON m.migration_name=e."migrationName"
 WHERE m.migration_name IS NULL OR e."migrationName" IS NULL OR m.checksum IS DISTINCT FROM e.checksum
 OR m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL) THEN
 RAISE EXCEPTION 'SCHEMA50_PRIOR_HISTORY_DRIFT'; END IF;
 PERFORM set_config('jobfinder.schema50_started_at',clock_timestamp()::text,true);
END;
$schema50_history$;
'''

def registration_finish(ddl):
    checksum = hashlib.sha256(ddl.encode()).hexdigest()
    if checksum != DDL_SHA256: raise ValueError('Canonical migration50 DDL drift')
    return f'''-- Honest bookkeeping for canonical DDL executed by this connector transaction.
-- This is NOT a receipt claiming that Prisma's migration engine ran.
INSERT INTO public."_prisma_migrations"
 (id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
VALUES (gen_random_uuid()::text,{literal(checksum)},clock_timestamp(),{literal(MIGRATION_NAME)},
 '{{"appliedBy":"official-connector","execution":"canonical-ddl-in-this-transaction","prismaEngineExecuted":false}}',
 NULL,current_setting('jobfinder.schema50_started_at')::timestamptz,1);
'''


def body(expected):
    validate_expected(expected)
    ddl = guard_ddl()
    payload = literal(json.dumps(expected, ensure_ascii=False, separators=(',', ':')))
    return f'''-- REVIEW DRAFT. No production execution is authorized by this file.
-- Requires one surrounding transaction. Do not split into autocommit statements.
SET LOCAL statement_timeout = '4000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL standard_conforming_strings = on;

DO $v75_preflight$
DECLARE
  actual public."ReleaseCandidate"%ROWTYPE;
  expected public."ReleaseCandidate"%ROWTYPE;
  formal_holder text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'V75_FENCE_READ_COMMITTED_REQUIRED';
  END IF;
  -- Same order as the existing DB_STARTED publisher. Never clear/reassign holder.
  SELECT "holderId" INTO formal_holder FROM public."CrawlCoordinatorLock"
    WHERE id = 'formal-crawl' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V75_FENCE_FORMAL_ROW_MISSING'; END IF;
  IF formal_holder IS DISTINCT FROM '' THEN RAISE EXCEPTION 'V75_FENCE_FORMAL_BUSY'; END IF;

  -- Drain existing relevant transactions before installing the new trigger.
  -- These locks allow ordinary SELECT but exclude concurrent relation writers.
  LOCK TABLE public."Job", public."CrawlBatchSourceResult", public."CrawlBatch"
    IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO actual FROM public."ReleaseCandidate"
    WHERE id = {literal(TARGET)} FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'V75_FENCE_CANDIDATE_MISSING'; END IF;
  SELECT * INTO expected FROM jsonb_populate_record(
    NULL::public."ReleaseCandidate", {payload}::jsonb);
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(to_jsonb(actual)) AS keys(k))
      IS DISTINCT FROM
     (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys({payload}::jsonb) AS keys(k)) THEN
    RAISE EXCEPTION 'V75_FENCE_CANDIDATE_SCHEMA_DRIFT';
  END IF;
  IF to_jsonb(actual) IS DISTINCT FROM to_jsonb(expected) THEN
    RAISE EXCEPTION 'V75_FENCE_FULL_CANDIDATE_TUPLE_DRIFT';
  END IF;
  IF EXISTS (SELECT 1 FROM public."CrawlBatchSourceResult"
      WHERE "releaseCandidateId" = {literal(TARGET)}
        AND "atomicCommitState"::text = 'PENDING') THEN
    RAISE EXCEPTION 'V75_FENCE_PENDING_RESULTS_EXIST';
  END IF;
  IF to_regprocedure('public.{FUNCTION}()') IS NOT NULL OR EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgrelid = 'public."CrawlBatchSourceResult"'::regclass
      AND tgname = {literal(TRIGGER)}) THEN
    RAISE EXCEPTION 'V75_FENCE_ALREADY_PRESENT_RECONCILE_DO_NOT_RETRY';
  END IF;
END;
$v75_preflight$;

{registration_preflight()}
{ddl}
{registration_finish(ddl)}
DO $v75_retire$
DECLARE affected bigint;
BEGIN
  UPDATE public."ReleaseCandidate" SET status = 'INVALIDATED'
    WHERE id = {literal(TARGET)} AND "goalId" = {literal(GOAL)}
      AND version = 75 AND "commitSha" = {literal(COMMIT)} AND status = 'BUILDING';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'V75_FENCE_RETIRE_COUNT'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public."CrawlBatchSourceResult"'::regclass
        AND tgname = {literal(TRIGGER)} AND tgenabled = 'O'
        AND tgfoid = 'public.{FUNCTION}()'::regprocedure) THEN
    RAISE EXCEPTION 'V75_FENCE_TRIGGER_NOT_ACTIVE';
  END IF;
END;
$v75_retire$;
-- Caller must COMMIT once and then verify with a separate official read.
-- A pre-COMMIT result is not a commit receipt. Unknown outcome must not be retried.
'''


def transaction(expected):
    return 'BEGIN ISOLATION LEVEL READ COMMITTED;\n' + body(expected) + '\nCOMMIT;\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--expected-candidate', type=pathlib.Path, required=True)
    ap.add_argument('--output-directory', type=pathlib.Path, required=True)
    args = ap.parse_args()
    row = json.loads(args.expected_candidate.read_text())
    validate_expected(row)
    args.output_directory.mkdir(parents=True, exist_ok=False)
    files = {'MIGRATION_BODY.sql': body(row), 'RETIREMENT_TRANSACTION.sql': transaction(row)}
    manifest = {'purpose': 'REVIEW_ONLY_NOT_PRODUCTION_AUTHORIZATION', 'target': TARGET,
                'expectedCandidateSha256': hashlib.sha256(args.expected_candidate.read_bytes()).hexdigest(),
                'files': []}
    for name, sql in files.items():
        data = sql.encode()
        (args.output_directory / name).write_bytes(data)
        manifest['files'].append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    (args.output_directory / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    main()
