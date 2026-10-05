#!/usr/bin/env python3
import datetime,hashlib,json,subprocess
from pathlib import Path
b=Path(__file__).resolve().parent.parent;h=b/'hosts46/servier'
sha=lambda x:hashlib.sha256(x).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,d):
 with p.open('x') as f:json.dump(d,f,ensure_ascii=False,indent=2);f.write('\n')
spec=read(h/'SPEC.json');checks=read(h/'CHECK_RESULTS.json');extra=read(h/'RESTORATION_CHECK_RESULTS.json')
assert checks['passed'] and extra['passed'] and len(checks['checks'])==13 and len(extra['checks'])==56
for name,v in spec['templateFiles'].items():assert sha((h/name).read_bytes())==v['sha256'] and sha(Path(v['originalPath']).read_bytes())==v['originalSha256']
old=read(h/'originals/PREPARED.json');originals={}
for name,expected in old['files'].items():
 actual=sha((h/'originals'/name).read_bytes());assert actual==expected
 originals[name]={'expectedSha256':expected,'actualSha256':actual,'matched':True}
for name in ['source-plan.json','context-read.sql','control-base.json','host-config.json','runtime/expected-database.json','runtime/fresh-readback.sql']:
 original=(h/'originals'/name).read_text();prepared=(h/name).read_text()
 if name.endswith('.sql'):
  assert prepared==original.replace(old['candidate']['id'],spec['candidate']['id'])
 elif name=='source-plan.json':assert prepared==original
 else:
  expected=json.loads(original)
  if name=='control-base.json':expected['build']=spec['build'];expected['candidate']=spec['candidate']
  elif name=='host-config.json':expected['root']=str(h);expected['repo']=str(b/'producer42')
  else:
   expected['candidate'].update(spec['candidate']);expected['candidate']['runtimeTreeHash']=spec['build']['runtimeTreeSha256'];expected['candidate']['adapterBundleHash']=read(b/'verification/CANDIDATE46_REGISTERED.json')['candidate']['adapterBundleHash']
  assert json.loads(prepared)==expected,name
assert not subprocess.check_output(['git','status','--porcelain'],cwd=b/'producer42',text=True).strip()
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=b/'producer42',text=True).strip()==spec['build']['commitSha']
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
write(h/'ORIGINAL_IDENTITY_VERIFICATION.json',{'checkedAt':now,'originalPreparedManifestFiles':len(originals),'allOriginalHashesMatched':True,'files':originals,'regeneratedMissingOriginalFiles':6,'currentConfigChangesOnly':['host root','producer root','C46 candidate id/version','registered current runtime/content/adapter bundle hash'],'generatedSourcePlanByteEqual':True,'generatedSqlOnlyCandidateIdChanged':True})
write(h/'PREPARED.json',{**spec,'status':'READY_FOR_PARENT_FRESH_CAPTURE_NOT_LAUNCHED','checkedAt':now,'localChecksPassed':True,'mainChecks':13,'additionalChecksAndHashComparisons':56,'allOriginalPreparedFileHashesMatched':True,'originalPreparedFiles':33,'localOriginalReferenceFiles':len([p for p in (h/'originals').rglob('*') if p.is_file()]),'loader':str(h/'runtime/load-servier42-runtime.js'),'freshReadbackStoreKey':'restored46:servier:freshReadbackCode','collectorHandoff':str(h/'COLLECTOR_HANDOFF.md'),'runbook':str(h/'RUNBOOK.md'),'frozenManifest':str(h/'FROZEN_MANIFEST.json'),'sha256sums':str(h/'SHA256SUMS'),'archiveRetentionPerformed':False,'livePublisherStateUntouched':True,'liveDueReadNotPerformed':True,'fullBuildOrBroadTestsRun':False})
files=[]
for p in sorted(h.rglob('*')):
 if not p.is_file():continue
 relative=p.relative_to(h)
 if any(x.startswith('NONQUAL') for x in relative.parts) or relative.parts[0] in ['readiness','captures'] or p.name in ['FROZEN_MANIFEST.json','SHA256SUMS']:continue
 files.append({'path':str(relative),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())})
tools=[b/'verification/restore-servier46.py',b/'verification/prepare-servier46.mjs',Path(__file__).resolve()]
write(h/'FROZEN_MANIFEST.json',{'schemaVersion':1,'frozenAt':now,'root':str(h),'sourceId':spec['sourceId'],'candidate':spec['candidate'],'build':spec['build'],'route':'B','namespace':spec['prefix'],'files':files,'preparationTools':[{'path':str(p),'sha256':sha(p.read_bytes())}for p in tools],'nonqualifyingSimulationDirectoriesExcluded':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'producerModified':False,'publicationAttempted':False,'archiveRetentionPerformed':False,'requiresParentFreshDueAndSinglePublisher':True})
frozen=sha((h/'FROZEN_MANIFEST.json').read_bytes());lines=[f"{x['sha256']}  {x['path']}\n" for x in files]+[f'{frozen}  FROZEN_MANIFEST.json\n']
with (h/'SHA256SUMS').open('x') as f:f.writelines(lines)
result=subprocess.run(['sha256sum','--check','--quiet','SHA256SUMS'],cwd=h,capture_output=True,text=True,check=True)
print(json.dumps({'readyForParent':True,'notLaunched':True,'root':str(h),'originalPreparedFilesVerified':33,'checks':69,'frozenFiles':len(files),'manifestSha256':frozen,'sha256sumsSha256':sha((h/'SHA256SUMS').read_bytes()),'sha256sumCheckPassed':True}))
