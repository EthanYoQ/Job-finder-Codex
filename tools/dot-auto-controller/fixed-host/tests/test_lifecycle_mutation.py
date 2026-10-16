"""New durable mutation and fixed-domain renderer regression tests (offline only)."""
from pathlib import Path
import hashlib,importlib.util,json,os,shutil,subprocess,sys,types,unittest
sys.dont_write_bytecode=True
H=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('lifecycle_renderer_test',H/'scripts/build-lifecycle-artifacts.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class MutationTests(unittest.TestCase):
 def setUp(self):
  p=subprocess.run([sys.executable,'-I',str(H/'tests/prepare-lifecycle-fixture.py')],input=b'return {};',capture_output=True,check=True)
  self.f=json.loads(p.stdout);self.case=Path(self.f['case']);self.m=types.ModuleType('mutation_case_'+self.case.name.replace('-','_'));self.m.__file__=self.f['modulePath'];sys.modules[self.m.__name__]=self.m
  exec(compile(Path(self.f['modulePath']).read_bytes(),self.f['modulePath'],'exec'),self.m.__dict__);self.domain=self.m.Domain.from_json(json.dumps(self.f['domain']))
 def tearDown(self):shutil.rmtree(self.case)
 def blocked(self):
  for mode in ('SH','EX'):
   with self.assertRaisesRegex(self.m.Hold,'ACTIVE_OR_UNKNOWN_MUTATION'):self.domain.acquire(mode)
 def test_no_finish_keeps_mutation_after_normal_return(self):
  with self.m.exclusive_transaction(self.domain):pass
  self.blocked()
 def test_exception_keeps_mutation(self):
  with self.assertRaises(ValueError):
   with self.m.exclusive_transaction(self.domain):raise ValueError('offline')
  self.blocked()
 def test_finish_is_owned_once_and_ex_stays_ex(self):
  with self.m.exclusive_transaction(self.domain) as lease:
   lease.finish_mutation_from_owned_transaction()
   with self.assertRaisesRegex(self.m.Hold,'JOURNAL_CLOSED'):lease.finish_mutation_from_owned_transaction()
   with self.assertRaisesRegex(self.m.Hold,'LIFECYCLE_BUSY'):self.domain.acquire('SH')
  with self.domain.acquire('SH'):pass
 def test_partial_marker_blocks_read_and_write(self):
  Path(self.f['mutation']).write_bytes(b'{')
  self.blocked()
 def test_link_marker_blocks_read_and_write(self):
  Path(self.f['mutation']).symlink_to('absent')
  self.blocked()
 def test_reconciliation_is_read_only_no_pid_or_age_cleanup(self):
  p=Path(self.f['mutation']);p.write_bytes(b'UNKNOWN DEAD PID')
  before=(p.stat(),p.read_bytes());r=self.m.read_reconciliation_diagnostic(self.domain)
  self.assertEqual(r['state'],'ACTIVE_OR_UNKNOWN');self.assertFalse(r['cleared']);self.assertFalse(r['grantsAuthority']);self.assertEqual(p.read_bytes(),before[1]);self.assertEqual(p.stat().st_ino,before[0].st_ino);self.blocked()
 def test_fixed_renderer_no_io_and_wrong_domain_before_io(self):
  raw=b.render_fixed_module((H/'lifecycle/lifecycle_lock.py').read_text());m=types.ModuleType('fixed_scope_render_test');sys.modules[m.__name__]=m;exec(compile(raw,'pure-render','exec'),m.__dict__)
  self.assertNotIn(b'__FIXED_LIFECYCLE_SCOPE__',raw)
  with self.assertRaisesRegex(m.Hold,'FIXED_DOMAIN_ONLY'):m._parent_scope(self.case,'installed-disabled')
 def test_offline_renderer_rejects_live_and_wrong_root(self):
  source=(H/'lifecycle/lifecycle_lock.py').read_text()
  for root in ('/tmp/wrong','/tmp/job-finder-fixed-live-controller-v1/lifecycle-cases'):
   with self.assertRaisesRegex(RuntimeError,'OFFLINE_RENDER_ONLY'):b.render_offline_module(source,root)
 def test_fixed_owner_bundle_pins_paths_without_touching_them(self):
  sources={'fixed-host/'+str(p.relative_to(H)):p.read_bytes() for p in (H/'functions').glob('*') if p.is_file()}
  sources.update({'fixed-host/'+str(p.relative_to(H)):p.read_bytes() for p in (H/'lifecycle').glob('*') if p.is_file()})
  domain={'parent':'/workspace/scratch/5e9614251709','target':'job-finder-fixed-live-controller-v1','parentIdentity':[1,2],'lockIdentity':[1,3]}
  out=b.render_fixed_owner_bundle(sources,domain,'a'*64,100,'b'*64)
  self.assertEqual(json.loads(out['binding.json'])['domain'],domain);self.assertIn(b'const ACTIVATION_LIFECYCLE=null;',out['functions-activate.js'])
  with self.assertRaisesRegex(RuntimeError,'FIXED_OWNER_DOMAIN'):b.render_fixed_owner_bundle(sources,{**domain,'target':'other'},'a'*64,100,'b'*64)
if __name__=='__main__':unittest.main()
