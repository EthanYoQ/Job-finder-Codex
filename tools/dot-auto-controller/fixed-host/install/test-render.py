import json,pathlib,runpy,unittest,hashlib
HERE=pathlib.Path(__file__).resolve().parent
render=runpy.run_path(str(HERE/'render-install.py'))['render']
class RenderTest(unittest.TestCase):
 def test_disabled(self):
  raw=render();self.assertIn(b'const INSTALL=null;',raw);self.assertNotIn(b'__FIXED_INSTALL_BINDING__',raw)
 def test_unknown_binding(self):
  with self.assertRaisesRegex(RuntimeError,'BINDING_KEYS'):render({'enabled':True})
 def test_fixed_bound_and_refuse_overrides(self):
  root='/workspace/scratch/5e9614251709/.job-finder-fixed-live-controller-v1.install-caller'
  row={**{k:v for k,v in json.loads((HERE/'retired-candidate.json').read_text()).items() if k not in ('createdAt','finalizedAt','releaseQaEvidenceSha256')},'id':'synthetic-install-fixture','commitSha':'a'*40,'migrationVersion':'20261014141000_v75_retired_candidate_fence','schemaHash':'6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7'}
  b={'schemaVersion':1,'repo':'EthanYoQ/Job-finder-Codex','projectId':'yiopvxysxrtrnvqxwgbx','commitSha':'a'*40,'treeSha':'b'*40,'holderSource':'# Synthetic fixture only','holderSha256':hashlib.sha256(b'# Synthetic fixture only').hexdigest(),'retirementSql':(HERE/'post-retirement.sql').read_text(),'registrationSql':(HERE.parent/'functions/bootstrap-query.sql.template').read_text().replace('__JOBFINDER_CANDIDATE_ID__',row['id']),'retiredCandidate':json.loads((HERE/'retired-candidate.json').read_text()),'expectedRow':row,'readerExpected':{'schemaVersion':1,'readers':{'main':{},'fallback':{}}}}
  native=json.loads((HERE.parents[1]/'config/reader-pins.json').read_text());api=json.loads((HERE.parents[1]/'config/reader-api-pins.json').read_text())
  for role in ('main','fallback'):
   b['readerExpected']['readers'][role]={'role':role,'readerFileHashes':{**native[role]['readerFileHashes'],'src/server/portablePublicationApi.ts':api[role]['apiSha256'],'src/server/publicApi.ts':api[role]['handlerSha256'],'src/domain/jobLocation.ts':api[role]['locationSha256']},'build':{k:'d'*64 for k in ('manifestSha256','entrypointSha256','proofModuleSha256')}}
  b['deploymentBytes']=json.dumps({'expectedRow':row,'build':{'commitSha':row['commitSha']},'fixturePreloadSha256':None})
  self.assertIn(b'const INSTALL={',render(b))
  for key,value in [('holderSource','changed bytes'),('holderSha256','0'*64),('retirementSql','SELECT true'),('registrationSql','DELETE FROM anything'),('readerExpected',None),('repo','elsewhere/repo')]:
   with self.subTest(key=key):
    with self.assertRaises(RuntimeError):render({**b,key:value})
if __name__=='__main__':unittest.main()
