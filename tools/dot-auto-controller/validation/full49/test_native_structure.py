"""Offline structural checks only. Never imports/executes the TS database runner."""
from pathlib import Path
import unittest,json,hashlib
R=Path(__file__).resolve().parent
D=(R/'overlay/tests/helpers/nativeFull49Db.ts').read_text()
F=(R/'overlay/tests/helpers/nativeFull49PublisherFixture.ts').read_text()
C=(R/'overlay/tests/helpers/nativeFull49Prepare.cli.ts').read_text()
class NativeStructure(unittest.TestCase):
 def test_local_only_explicit_execution(self):
  for s in ['ALLOWED_SOCKET','RUN_NEW_EMPTY_LOCAL_TEST_DATABASE',"row.listen!==''",'!row.empty','jf_retirement_test_']:self.assertIn(s,D)
  self.assertNotIn('connectionString',D);self.assertNotIn('new URL(',D)
 def test_all49_hashes_before_first_schema_write(self):
  self.assertLess(D.index('const files=await Promise.all'),D.index("await this.execute(LEDGER"))
  self.assertIn('manifest.prior49.length!==49',D);self.assertIn('MIGRATION_BYTES_DRIFT',D)
 def test_ledger_after_real_migration_return(self):
  self.assertLess(D.index("await this.execute(f.sql"),D.index('INSERT INTO public."_prisma_migrations"'))
  for field in ['id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count','prismaEngineExecuted:false','ddlAndLedgerAtomic:false']:self.assertIn(field,D)
 def test_no_wasm_or_crypto_shim(self):
  self.assertNotIn('PGlite',D+F);self.assertNotIn('allowTestHashShim',D+F)
  self.assertIn("crypto.name!=='pgcrypto'",D)
 def test_failing_mutation_poisoned_no_retry(self):
  self.assertIn('this.failed=true',D);self.assertIn('CLOSED_OR_FAILED_NO_RETRY',D)
  self.assertIn("flag:'wx'",D)
 def test_real_admission_pipeline(self):
  stages=['await runSourceCrawl','await archiveSourceEvidence','await issueSourceQualityAdmission','compileCloudPilotPublicationContextSql(common','await prepareDbStartedCloudPublicationReplay(input)','await replay.recompile()']
  indexes=[F.index(s) for s in stages];self.assertEqual(indexes,sorted(indexes))
  self.assertIn('sourceQualityAdmission:admission',F);self.assertIn('attemptTracker',F)
  self.assertNotIn('vi.mock',F);self.assertNotIn('vi.useFakeTimers',F)
 def test_http_never_falls_back_network(self):
  self.assertNotIn('await originalFetch',F);self.assertIn('UNEXPECTED_SYNTHETIC_HTTP_TARGET',F)
  self.assertIn('finally{globalThis.fetch=originalFetch;generating=false;}',F)
 def test_candidate_freshness_and_byte_recompile(self):
  self.assertIn('Object.keys(expectedCandidate).length!==19',F)
  self.assertIn('Date.now()>=Date.parse(packet.expiresAt)',F)
  self.assertIn('fullRecompileByteMatched:true',F)
 def test_cli_does_not_dispatch_prepared_packets(self):
  self.assertNotIn('execute(fixture',C);self.assertNotIn('query(fixture',C)
  self.assertIn('publisherDispatched:false',C);self.assertIn('retirementDispatched:false',C)
  self.assertIn('CANONICAL_RENDERER_DRIFT',C)
 def test_native_ledger_metadata_only_transform(self):
  self.assertIn("canonical.split(originalLog).length!==2",C)
  self.assertIn("testSql.replace(testLog,originalLog)!==canonical",C)
  self.assertIn('native-full49-test-runner',C)
  self.assertIn('gatesModified:false',C)
 def test_auxiliary_pins(self):
  for name,expected in json.loads((R/'NATIVE_INPUT_PINS.json').read_text()).items():self.assertEqual(hashlib.sha256((R/name).read_bytes()).hexdigest(),expected)
if __name__=='__main__':unittest.main(verbosity=2)
