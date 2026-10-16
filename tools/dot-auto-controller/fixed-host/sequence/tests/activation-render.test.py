"""Pure source rendering. Official facts below are explicitly synthetic data.

No path provisioning, registration, source launch or activation takes place.
The original measured EX qualification is tested separately after installation.
"""
from pathlib import Path
import copy,hashlib,json,runpy,sys,types,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parents[1]
test=runpy.run_path(str(HERE/'tests/canonical.test.py'))
b=test['b'];inputs=b.load_source_inputs();release=test['synthetic_release'](inputs)
pins={'sourceManifestSha256':'e'*64,'builderSha256':b.sha((HERE/'build-functions-entry.py').read_bytes()),'canonicalDefaultSha256':b.sha(b.render_entry(inputs))}
p=HERE/'activation-renderer.py';a=types.ModuleType('sequence_activation_test');a.__file__=str(p);a.ACTIVATION_PINS=pins;exec(compile(p.read_bytes(),str(p),'exec'),a.__dict__)
fact={'kind':'OFFICIAL_GITHUB_COMMIT_READ','repository':'EthanYoQ/Job-finder-Codex','commitSha':'c'*40,'observedAt':'2026-10-16T00:00:00Z','responseSha256':'f'*64}
class Activation(unittest.TestCase):
 def render(self,r=release,f=fact):return a.render(b.PACKAGE,b.encoded(r).encode(),f)
 def test_exact_single_outer_activation_delta(self):
  r=self.render();self.assertEqual(r['enabled'],r['disabled'].replace(b'"enabled":false',b'"enabled":true',1))
  self.assertEqual(r['disabled'].count(b'const ACTIVATION='),1)
  for name in b.ORDER:self.assertIn(('function create_'+name).encode(),r['disabled'])
  self.assertEqual(set(r['binding']['profiles']),set(b.ORDER))
  self.assertNotEqual(r['binding']['profiles']['takeda']['cliSha256'],r['binding']['profiles']['biogen']['cliSha256'])
 def test_remote_fact_and_profile_drift_reject(self):
  other=copy.deepcopy(fact);other['commitSha']='d'*40
  with self.assertRaisesRegex(RuntimeError,'REMOTE_COMMIT'):self.render(f=other)
  for key in ('build','expectedRow','sourceId','sourceConfigSha256'):
   r=copy.deepcopy(release);r['profiles']['biogen'][key]={} if key in ('build','expectedRow') else 'wrong'
   with self.assertRaises((RuntimeError,KeyError)):self.render(r=r)
 def test_only_original_fixed_source_bytes(self):
  r=self.render();helper=inputs['fixed-host/sequence/local-activation.py.in'].decode().replace('__BINDING_PY__',repr(r['binding']))
  compile(helper,'<pure-qualified-helper>','exec')
  for original in ('source_inventory()','LIFECYCLE_LEASE','ACTIVATION_REGISTRATION_16',"cli['age'](packet['checkedAt'],60)",'record_activation_started();put(enabled)','ACTIVATION_COMPLETE_SOURCE_SET'):
   self.assertIn(original,helper)
  self.assertIn("for profile in ('takeda','biogen','hengrui'):",helper)
 def test_measured_pin_closed_set(self):
  old=a.ACTIVATION_PINS
  try:
   a.ACTIVATION_PINS={**pins,'extra':'a'*64}
   with self.assertRaisesRegex(RuntimeError,'MEASURED_PINS'):self.render()
  finally:a.ACTIVATION_PINS=old
if __name__=='__main__':unittest.main()
