import hashlib,json,re,unittest,copy
from pathlib import Path
from verify_catalog import verify
R=Path(__file__).resolve().parent
class Inputs(unittest.TestCase):
 def test_49_exact_bytes(self):
  m=json.loads((R/'INPUT_MANIFEST.json').read_text());self.assertEqual(len(m['prior49']),49)
  for x in m['prior49']:self.assertEqual(hashlib.sha256((R/'migrations49'/x['migrationName']/'migration.sql').read_bytes()).hexdigest(),x['checksum'])
  self.assertEqual(hashlib.sha256(json.dumps(m['prior49'],separators=(',',':')).encode()).hexdigest(),m['prior49ManifestSha256'])
 def test_cohort_inputs_not_skip(self):
  self.assertEqual((R/'before-cohort.synthetic.sql').read_text().count('INSERT INTO'),60)
  self.assertTrue((R/'migrations49/20260927120000_p0_launch_cohort_41_companies/migration.sql').exists())
 def test_native_extension_unchanged(self):
  self.assertIn('CREATE EXTENSION IF NOT EXISTS pgcrypto;',(R/'migrations49/20260711220000_lifecycle_set_cryptographic_closure/migration.sql').read_text())
  self.assertIn('ALTER EXTENSION pgcrypto SET SCHEMA extensions;',(R/'migrations49/20260711240000_lifecycle_trigger_security_closure/migration.sql').read_text())
 def row(self):
  e=json.loads((R/'CATALOG_EXPECTED.json').read_text());m=json.loads((R/'INPUT_MANIFEST.json').read_text())
  return {'serverVersion':'170011','ledger':[{**r,'finished':True,'rolledBack':False} for r in m['prior49']], 'crypto':{'name':'pgcrypto','schema':'extensions','version':'1.3'},'functions':e['functions'],'triggers':[{**t,'enabled':'O','deferrable':True,'initiallyDeferred':True} for t in e['triggers']],'baselineCheckMd5':e['baselineCheckMd5'],'sourceGuardProsrcSha256':e['sourceGuardProsrcSha256'],'fencePresent':False}
 def test_catalog_only_never_concurrency(self):self.assertFalse(verify(self.row())['concurrencyPassed'])
 def test_crypto_shim_rejected(self):
  r=self.row();r['crypto']=None
  with self.assertRaises(ValueError):verify(r)
 def test_disabled_trigger_rejected(self):
  r=self.row();r['triggers'][0]['enabled']='D'
  with self.assertRaises(ValueError):verify(r)
 def test_fake_or_missing_ledger_rejected(self):
  r=self.row();r['ledger'].pop()
  with self.assertRaises(ValueError):verify(r)
 def test_changed_function_rejected(self):
  r=self.row();r['functions'][next(iter(r['functions']))]='0'*32
  with self.assertRaises(ValueError):verify(r)
if __name__=='__main__':unittest.main(verbosity=2)
