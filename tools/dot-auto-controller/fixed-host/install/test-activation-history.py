"""Unit test: actual marker writer under a real offline EX lease.
Does not claim activation qualification; no source/DB gate is replaced.
"""
import hashlib,json,pathlib,runpy,tempfile,types,sys,unittest
HERE=pathlib.Path(__file__).resolve().parent
class HistoryTest(unittest.TestCase):
 def test_permanent_marker_under_real_ex(self):
  cases=HERE.parents[3]/'evidence/activation-history/lifecycle-cases';cases.mkdir(parents=True,exist_ok=True)
  case=pathlib.Path(tempfile.mkdtemp(prefix='case-',dir=cases));target=case/'installed-disabled';target.mkdir();owner=case/'.installed-disabled.lifecycle-owner';owner.mkdir(mode=0o700)
  renderer=runpy.run_path(str(HERE.parent/'scripts/build-lifecycle-artifacts.py'))
  raw=renderer['render_offline_module']((HERE.parent/'lifecycle/lifecycle_lock.py').read_text(),cases)
  module=types.ModuleType('marker_offline_lifecycle');module.__file__='<test-only-module>';sys.modules[module.__name__]=module;exec(compile(raw,module.__file__,'exec'),module.__dict__)
  domain=module.provision_for_installer(case,'installed-disabled')
  binding={'deploymentSha256':'a'*64,'enabledEntrySha256':'b'*64}
  helper=(HERE/'templates/local-activation.py.in').read_text().replace('__BINDING_PY__',repr(binding))
  old='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1';self.assertEqual(helper.count(old),1);helper=helper.replace(old,str(target))
  with module.exclusive_transaction(domain) as lease:
   ns={'__name__':'marker_test_only','__file__':'<marker-test-only>','LIFECYCLE_LEASE':lease};exec(compile(helper,ns['__file__'],'exec'),ns)
   ns['never_activated']();ns['record_activation_started']()
   path=owner/'ACTIVATION_STARTED';self.assertEqual(json.loads(path.read_bytes()),{'schemaVersion':1,**binding});self.assertEqual(path.stat().st_mode&0o777,0o400)
   with self.assertRaisesRegex(RuntimeError,'ACTIVATION_HISTORY_EXISTS'):ns['never_activated']()
   with self.assertRaises(FileExistsError):ns['record_activation_started']()
   self.assertFalse((target/'candidate/functions-entry.enabled.js').exists());lease.finish_mutation_from_owned_transaction()
  self.assertTrue((owner/'ACTIVATION_STARTED').exists())
if __name__=='__main__':unittest.main()
