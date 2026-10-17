#!/usr/bin/env python3
"""Pure source renderer; never provisions paths or invents remote facts.
A bound artifact is a fixed trusted caller, not a caller-configurable installer.
Actual source/runtime measurements and actual reader expected identity are required.
"""
import hashlib,json,pathlib,re
PROFILE=pathlib.Path(__file__).resolve().parent
HERE=PROFILE.parent/'install'
PARENT='/workspace/scratch/5e9614251709'
def require(ok,code):
 if not ok:raise RuntimeError(code)
def canonical(x):return json.dumps(x,sort_keys=True,ensure_ascii=False,separators=(',',':'))
def render(binding=None):
 template=(HERE/'install.functions.template.js').read_text()
 facts=(HERE/'facts.mjs').read_text();facts=re.sub(r'^export \{[^\n]+\};\n?$', '',facts,flags=re.M)
 digest=(HERE.parent/'functions/sha256.js').read_text() if (HERE.parent/'functions/sha256.js').exists() else None
 require(digest is not None,'INSTALL_DIGEST_SOURCE_MISSING')
 if binding is not None:
  required={'schemaVersion','repo','projectId','commitSha','treeSha','holderSource','holderSha256','retirementSql','registrationSql','retiredCandidate','expectedRow','readerExpected','deploymentBytes'}
  require(set(binding)==required,'INSTALL_RENDER_BINDING_KEYS')
  require(binding['schemaVersion']==1 and binding['repo']=='EthanYoQ/Job-finder-Codex' and binding['projectId']=='yiopvxysxrtrnvqxwgbx','INSTALL_RENDER_PROJECT')
  require(type(binding['holderSource']) is str and 0<len(binding['holderSource'])<=2*1024*1024 and re.fullmatch(r'[\x09\x0a\x0d\x20-\x7e]*',binding['holderSource']) and hashlib.sha256(binding['holderSource'].encode()).hexdigest()==binding['holderSha256'],'INSTALL_EMBEDDED_HOLDER_PIN')
  require(re.fullmatch('[a-f0-9]{40}',binding['commitSha']) and re.fullmatch('[a-f0-9]{40}',binding['treeSha']) and re.fullmatch('[a-f0-9]{64}',binding['holderSha256']),'INSTALL_RENDER_PINS')
  require(binding['retirementSql']==(HERE/'post-retirement.sql').read_text() and binding['retiredCandidate']==json.loads((HERE/'retired-candidate.json').read_text()),'INSTALL_FIXED_RETIREMENT')
  row_keys={'id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','oracleVersion','minimumStableCompanyCount','status'}
  require(type(binding['expectedRow']) is dict and set(binding['expectedRow'])==row_keys,'INSTALL_EXPECTED_16')
  require(binding['expectedRow']['commitSha']==binding['commitSha'] and binding['expectedRow']['migrationVersion']=='20261014141000_v75_retired_candidate_fence' and binding['expectedRow']['schemaHash']=='6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7','INSTALL_SCHEMA50_IDENTITY')
  require(type(binding['readerExpected']) is dict and binding['readerExpected'].get('schemaVersion')==1 and set(binding['readerExpected'].get('readers',{}))=={'main','fallback'},'INSTALL_REAL_READER_EXPECTED_REQUIRED')
  native=json.loads((HERE.parents[1]/'config/reader-pins.json').read_text());api=json.loads((HERE.parents[1]/'config/reader-api-pins.json').read_text())
  for role in ('main','fallback'):
   e=binding['readerExpected']['readers'][role]
   hashes={**native[role]['readerFileHashes'],'src/server/portablePublicationApi.ts':api[role]['apiSha256'],'src/server/publicApi.ts':api[role]['handlerSha256'],'src/domain/jobLocation.ts':api[role]['locationSha256']}
   require(type(e) is dict and e.get('role')==role and e.get('readerFileHashes')==hashes and len(hashes)==19,'INSTALL_READER_PINS')
   require(type(e.get('build')) is dict and all(re.fullmatch('[a-f0-9]{64}',str(e['build'].get(k,''))) for k in ('manifestSha256','entrypointSha256','proofModuleSha256')),'INSTALL_READER_BUILD')
  require(type(binding['deploymentBytes']) is str,'INSTALL_DEPLOYMENT_BYTES')
  deployment=json.loads(binding['deploymentBytes'])
  require(deployment.get('sourceId')=='source-hengrui-social' and deployment.get('sourceConfigSha256')=='93dcadb4a572da022694b3ab3040fad541fe674107e3dc66fd2323709e374b4e','INSTALL_FIXED_SOURCE')
  require(deployment['expectedRow']==binding['expectedRow'] and deployment['build']['commitSha']==binding['commitSha'] and deployment['fixturePreloadSha256'] is None,'INSTALL_DEPLOYMENT_IDENTITY')
  candidate_id=binding['expectedRow']['id']
  require(type(candidate_id) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}',candidate_id),'INSTALL_CANDIDATE_ID')
  expected_sql=(HERE.parent/'functions/bootstrap-query.sql.template').read_text().replace('__JOBFINDER_CANDIDATE_ID__',candidate_id)
  require(binding['registrationSql']==expected_sql,'INSTALL_FIXED_REGISTRATION_SQL')
  binding={**binding,'bindingSha256':hashlib.sha256(canonical(binding).encode()).hexdigest()}
 for key,value in {'__FIXED_INSTALL_BINDING__':canonical(binding),'__FIXED_SHA256_SOURCE__':json.dumps(digest),'__FIXED_FACTS_SOURCE__':json.dumps(facts)}.items():
  require(template.count(key)==1,'INSTALL_TEMPLATE_TOKEN');template=template.replace(key,value)
 return template.encode('ascii')

def render_holder(measured_pins,control):
 """Render only the fixed production domain. Tests remap in a separate harness."""
 import types,sys
 keys={'repo','projectId','commitSha','treeSha','retiredCandidate','expectedRow','readerExpected','deploymentBytes'}
 require(type(control) is dict and set(control)==keys,'INSTALL_HOLDER_CONTROL_KEYS')
 require(measured_pins['commitSha']==control['commitSha']==measured_pins['buildIdentity']['commitSha'],'INSTALL_HOLDER_MEASURED_COMMIT')
 generator_path=HERE.parent/'scripts/build-lifecycle-artifacts.py'
 ns={'__name__':'install_fixed_lifecycle_renderer','__file__':str(generator_path)}
 exec(compile(generator_path.read_bytes(),str(generator_path),'exec'),ns)
 lifecycle=ns['render_fixed_module']((HERE.parent/'lifecycle/lifecycle_lock.py').read_text()).decode()
 binding={'schemaVersion':1,'scope':{'kind':'FIXED_PRODUCTION','parent':PARENT,'target':'job-finder-fixed-live-controller-v1'},'measuredPins':measured_pins,'controlBinding':control}
 tokens={'__FIXED_INSTALL_HOLDER_BINDING__':binding,'__FIXED_INSTALL_LIFECYCLE_SOURCE__':lifecycle,'__FIXED_INSTALL_STAGING_SOURCE__':(HERE/'staging.py.in').read_text(),'__FIXED_INSTALL_READER_SOURCE__':(HERE/'reader-helper.mjs').read_text(),'__FIXED_INSTALL_FACTS_SOURCE__':(HERE/'facts.mjs').read_text(),'__FIXED_INSTALL_BOUND_ARTIFACTS_SOURCE__':(PROFILE/'bound-artifacts.py.in').read_text()}
 source=(HERE/'install-holder.py.in').read_text()
 for token,value in tokens.items():
  require(source.count(token)==1,'INSTALL_HOLDER_TEMPLATE_TOKEN:'+token);source=source.replace(token,repr(value))
 require(source.isascii(),'INSTALL_HOLDER_ASCII');compile(source,'<fixed-install-holder>','exec')
 return source

def build(measured_pins,control):
 """Complete deterministic artifact generation; no filesystem writes/actions."""
 holder=render_holder(measured_pins,control)
 binding={'schemaVersion':1,**control,'holderSource':holder,'holderSha256':hashlib.sha256(holder.encode()).hexdigest(),'retirementSql':(HERE/'post-retirement.sql').read_text(),'registrationSql':(HERE.parent/'functions/bootstrap-query.sql.template').read_text().replace('__JOBFINDER_CANDIDATE_ID__',control['expectedRow']['id'])}
 return render(binding)
