"""Pure four-profile install renderer checks, all identity facts synthetic.
No installation, path provisioning, qualification, SQL or dependency copy occurs.
"""
from pathlib import Path
import copy,json,runpy,sys,types,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(HERE/'tests/canonical.test.py'));b=ns['b'];inputs=b.load_source_inputs();release=ns['synthetic_release'](inputs)
p=HERE/'render-install.py';m=types.ModuleType('pure_install_closure');m.__file__=str(p);exec(compile(p.read_bytes(),str(p),'exec'),m.__dict__)
native=json.loads((b.PACKAGE/'config/reader-pins.json').read_bytes());api=json.loads((b.PACKAGE/'config/reader-api-pins.json').read_bytes())
reader={'schemaVersion':1,'readers':{}}
for role in ('main','fallback'):
 hashes={**native[role]['readerFileHashes'],'src/server/portablePublicationApi.ts':api[role]['apiSha256'],'src/server/publicApi.ts':api[role]['handlerSha256'],'src/domain/jobLocation.ts':api[role]['locationSha256']}
 reader['readers'][role]={'role':role,'readerFileHashes':hashes,'build':{k:'a'*64 for k in ('manifestSha256','entrypointSha256','proofModuleSha256')}}
d=release['profiles']['takeda'];pins={'commitSha':d['build']['commitSha'],'buildIdentity':d['build']}
control={'repo':'EthanYoQ/Job-finder-Codex','projectId':release['projectId'],'commitSha':pins['commitSha'],'treeSha':'d'*40,'retiredCandidate':json.loads((m.INSTALL/'retired-candidate.json').read_bytes()),'expectedRow':d['expectedRow'],'readerExpected':reader,'deploymentBytes':b.encoded(release)}
class Render(unittest.TestCase):
 def binding(self,release=release):
  c={**control,'deploymentBytes':b.encoded(release)};holder=m.render_holder(pins,c)
  return {'schemaVersion':1,**c,'holderSource':holder,'holderSha256':b.sha(holder.encode()),'retirementSql':(m.INSTALL/'post-retirement.sql').read_text(),'registrationSql':(b.HOST/'functions/bootstrap-query.sql.template').read_text().replace('__JOBFINDER_CANDIDATE_ID__',d['expectedRow']['id'])}
 def test_pure_installer_is_disabled_and_has_four_executable_cli_sets(self):
  binding=self.binding();source=binding['holderSource'];compile(source,'<synthetic-facts-pure-holder>','exec')
  self.assertLess(len(source.encode()),2*1024*1024)
  for name in b.ORDER:
   for leaf in ('preimport-launch.py','preflight.mjs','recovery-helper.mts'):
    self.assertIn('candidate/fixed-'+name+'-'+leaf,source)
  out=m.render(binding);self.assertIn(b'CLOSED_FOUR_SOURCE_RELEASE',out)
  self.assertEqual(m.build(pins,control),out)
 def test_hengrui_shared_identity_drift_rejects_at_install_boundary(self):
  for profile in ('hengrui','ucb'):
   for key in ('expectedRow','build'):
    bad=copy.deepcopy(release);bad['profiles'][profile][key]={**bad['profiles'][profile][key],'extra':'drift'}
    with self.assertRaisesRegex(RuntimeError,'INSTALL_SHARED_RELEASE'):m.render(self.binding(bad))
 def test_incomplete_or_unbounded_profile_release_rejected(self):
  for kind in ('missing','missing-ucb','extra','old-kind','old-three-kind'):
   bad=copy.deepcopy(release)
   if kind=='missing':bad['profiles'].pop('hengrui')
   elif kind=='missing-ucb':bad['profiles'].pop('ucb')
   elif kind=='extra':bad['profiles']['other']=copy.deepcopy(d)
   else:bad['kind']='CLOSED_THREE_SOURCE_RELEASE' if kind=='old-three-kind' else 'CLOSED_TWO_SOURCE_RELEASE'
   with self.assertRaisesRegex(RuntimeError,'INSTALL_(SHARED_RELEASE|CLOSED_RELEASE)'):m.render(self.binding(bad))
if __name__=='__main__':unittest.main()
