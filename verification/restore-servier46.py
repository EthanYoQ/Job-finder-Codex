#!/usr/bin/env python3
"""Offline restoration of the exact reviewed Servier B host with current bindings."""
import difflib,hashlib,json
from pathlib import Path
base=Path(__file__).resolve().parent.parent
origin=base/'code80-servier-contracts/operations/increment74/hosts/servier42-refresh'
host=base/'hosts46/servier';repo=base/'producer42'
old_base='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
old_host=old_base+'/hosts/servier42-refresh';old_candidate='dot-cloud-restored-fb0b8e3-20261004'
control=json.loads((base/'verification/candidate46-input.json').read_text());control.pop('expiresAt',None)
build=json.loads((base/'verification/restored-build-identity.json').read_text())
registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
assert control['build']==build and control['candidate']=={k:registered[k] for k in ['id','goalId','version']}
prepared=json.loads((origin/'PREPARED.json').read_text());source=prepared['sourceId'];config=prepared['sourceConfigSha256']
catalog=json.loads((base/'verification/servier46-original-extracted-manifest.json').read_text());expected={x['localPath']:x['sha256'] for x in catalog['files']}
expected[str(origin/'runtime/fresh-readback.sql')]=prepared['files']['runtime/fresh-readback.sql']
sha=lambda b:hashlib.sha256(b).hexdigest()
def put(p,b):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with p.open('xb') as f:f.write(b if isinstance(b,bytes) else b.encode())
 p.chmod(0o600)
def js(p,v):put(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def bind(t):return t.replace(old_host,str(host)).replace(old_base+'/producer-source',str(repo)).replace(old_candidate,control['candidate']['id']).replace('servier42:','restored46:servier:')
files={};skip=['PREPARED.json','SPEC.json','CHECK_RESULTS.json','SHA256SUMS','TEMPLATE_PROVENANCE.json','PREPARATION_BASELINE.json','runtime/check-host.mjs','runtime/check-overlap-gate.mjs','runtime/prepare-host.py','runtime/prepare-metadata.mjs','RUNBOOK.md','COLLECTOR_HANDOFF.md','HISTORICAL_REVIEW_SHAPE.json']
for p in sorted(origin.rglob('*')):
 if not p.is_file():continue
 raw=p.read_bytes();assert sha(raw)==expected[str(p)],str(p)
 name=str(p.relative_to(origin));put(host/'originals'/name,raw)
 if name in skip:continue
 t=bind(raw.decode())
 if name=='runtime/load-host-state.js':
  t=t.replace("!root.startsWith('"+old_base+"/hosts/')",'root!=='+json.dumps(str(host)))
  t=t.replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(control['candidate']['id']))
 if name=='runtime/publisher-state-guard.mjs':
  t=t.replace(old_base+'/PUBLISHER-ACTIVE-STATE.json',str(base/'PUBLISHER-ACTIVE-STATE.json')).replace('state.runtimeCandidate.version!==42','state.runtimeCandidate.version!==46')
 if name=='runtime/review-publication.py':t=t.replace("host.name=='servier42-refresh'",'str(host)=='+repr(str(host)))
 if name=='runtime/start-monitor-servier42.js':
  t=t.replace("if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch??''))","if(typeof batch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))")
 if name=='runtime/preflight/preflight-launch.mjs':
  t=t.replace("|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)","|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
 put(host/name,t)
 diff=''.join(difflib.unified_diff(raw.decode().splitlines(True),t.splitlines(True),fromfile='original/'+name,tofile='restored/'+name))
 put(host/'diffs'/(name.replace('/','__')+'.diff'),diff)
 files[name]={'template':str(p),'templateSha256':sha(raw),'originalPath':str(host/'originals'/name),'originalSha256':sha(raw),'sha256':sha(t.encode()),'diffSha256':sha(diff.encode())}
js(host/'host-config.json',{'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':source,'sourceConfigSha256':config})
js(host/'control-base.json',control)
gate=lambda t:t.split('// BEGIN STRICT_HISTORICAL_OVERLAP_GATE\n')[1].split('// END STRICT_HISTORICAL_OVERLAP_GATE')[0]
assert gate((origin/'runtime/fresh-readback.js').read_text())==gate((host/'runtime/fresh-readback.js').read_text())
assert (origin/'runtime/observation-due-gate.js').read_bytes()==(host/'runtime/observation-due-gate.js').read_bytes()
js(host/'RESTORATION_MANIFEST.json',{'schemaVersion':1,'status':'RESTORED_PENDING_LOCAL_VERIFICATION','sourceKey':'servier','root':str(host),'repo':str(repo),'prefix':'restored46:servier:','sourceId':source,'sourceConfigSha256':config,'route':'B','heapMiB':256,'starter':'runtime/start-monitor-servier42.js','startCodeKey':'restored46:servier:restoredBSourceStartCode','candidate':control['candidate'],'build':build,'templateFiles':files,'exactOriginalFilesVerified':len(expected),'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'strictHistoricalOverlapGateSha256':sha(gate((origin/'runtime/fresh-readback.js').read_text()).encode()),'originalObservationDueGateSha256':sha((origin/'runtime/observation-due-gate.js').read_bytes()),'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'automaticPublication':False,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['Generic preflight launch is portable-only. Use only check plus the dedicated Servier starter.','ARCHIVE_STORE references absent audit-novo-public-archive.mjs. This inherited branch is outside DB_STARTED_OWNER_V1 and must not be used.']})
print(json.dumps({'root':str(host),'verifiedOriginalFiles':len(expected),'notLaunched':True}))
