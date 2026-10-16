"""Offline implementation-shape checks. No TS execution or database access."""
from pathlib import Path
import unittest
R=Path(__file__).resolve().parent
A=(R/'overlay/tests/helpers/nativeFull49Acceptance.cli.ts').read_text()
S=(R/'overlay/tests/helpers/nativeFull49Summarize.cli.ts').read_text()
Y=(R/'review-only-ci/github-actions-full49.draft.yml').read_text()
F=(R/'retirement.production-reference.sql').read_text()
class AcceptanceStructure(unittest.TestCase):
 def test_native_chain(self):
  for x in ['await db.replay49()', 'await db.execute(baseline.wrappedSql', 'await createNativeFull49PublisherFixture(db)', 'await fixture.recompile()', 'await renderNativeRetirement', "b.query(bSql)"]:self.assertIn(x,A)
  self.assertNotIn('fixture.sql',A);self.assertNotIn('reduced',A.lower().split('*/',1)[1])
 def test_full_formal_transaction_reference(self):
  for x in ['formal-crawl','FOR UPDATE','SHARE ROW EXCLUSIVE','public."Job"','public."CrawlBatchSourceResult"','public."CrawlBatch"','CREATE FUNCTION','CREATE TRIGGER','INSERT INTO public."_prisma_migrations"','COMMIT;']:self.assertIn(x,F)
  self.assertIn('stripRetirement(retirement)',A);self.assertIn("else success(await a.query(retireBody))",A)
 def test_server_concurrency_not_client_overlap(self):
  for x in ['pg_blocking_pids','pg_backend_pid()','txid_current()','clock_timestamp()','REAL_DISTINCT_BLOCKING_EDGE_REQUIRED','DATABASE_INTERVALS_NOT_OVERLAPPING','EXACT_COMMIT_ACK_REQUIRED']:self.assertIn(x,A)
 def test_committed_baseline_and_readback(self):
  for x in ['ONE_REAL_BASELINE_JOB_REQUIRED','HISTORICAL_EVIDENCE_CHANGED','JOB_COMMIT_OR_ROLLBACK_MISMATCH','EXACT_SOURCE_AFTER_COMMIT_MISMATCH','OLD_LEDGER_CHANGED','FULL_FENCE_PROFILE_REQUIRED']:self.assertIn(x,A)
 def test_case_matrix_is_complete(self):
  for x in ['publish_commit','publish_rollback','retire_commit','retire_rollback','deferred_commit_failure','lock_timeout','post_retire_trigger_atomicity']:self.assertIn(x,A);self.assertIn(x,Y)
  for x in ['JOB_DELTA_COMMIT_PROJECTION_MISMATCH','PILOT_MIGRATION_HISTORY','V75_FENCE_CANDIDATE_RETIRED','55P03']:self.assertIn(x,A)
 def test_distinct_databases_full_replay_matrix(self):
  for x in ['databases.has(e.database)','ledgerFiles.length!==49','REAL_REPLAY_RECEIPTS_REQUIRED','classifyFull49(e)','PASS_FULL49_NATIVE_MATRIX','productionQualified:false']:self.assertIn(x,S)
 def test_review_only_ci_no_production_connection(self):
  self.assertFalse((R/'.github/workflows').exists())
  self.assertIn('--network none',Y);self.assertIn("listen_addresses=''",Y)
  self.assertIn('postgres:17',Y);self.assertIn('persist-credentials: false',Y)
  self.assertNotIn('secrets.',Y);self.assertNotIn('reduced',Y)
if __name__=='__main__':unittest.main(verbosity=2)
