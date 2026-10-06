#!/usr/bin/env python3
"""Offline restore of original MSD TRUE_A host; frozen C46 Ajinga plan is authoritative."""
import difflib,hashlib,json,re,sys
from pathlib import Path
base=Path(__file__).resolve().parent.parent;root=base/'hosts46';repo=base/'producer42'
archive=base/'code80-minimal';origin=archive/'operations/increment68/hosts/refresh42-20261004T1330Z'
oldbase='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
selection={'msd':'source-msd-china-social'}
key=sys.argv[1];assert key in selection;sourceId=selection[key];host=root/key;assert not host.exists(),str(host)
load=lambda p:json.loads(p.read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
control=load(base/'verification/candidate46-input.json');registered=load(base/'verification/CANDIDATE46_REGISTERED.json')['candidate'];active=load(base/'PUBLISHER-ACTIVE-STATE.json');candidate=control['candidate']['id']
assert candidate==registered['id']==active['runtimeCandidate']['id'] and control['candidate']['version']==registered['version']==active['runtimeCandidate']['version']==46
assert active['runtimeCandidate']['commit']==control['build']['commitSha']
for field in ['sourceTreeSha256','runtimeTreeSha256']:assert active['runtimeCandidate'][field]==control['build'][field]
assert key not in {s['sourceKey'] for s in active['pendingReadOnlyTerminalSources']}
assert control['build']==load(base/'verification/restored-build-identity.json')
originalManifest=load(archive/'FILE_MANIFEST.json'); extracted=load(base/'verification/code80-minimal-extracted-manifest.json');verified=[]
extractedByPath={x['archivePath']:x for x in extracted}
sums={line.split('  ',1)[1]:line.split('  ',1)[0] for line in (origin/'SHA256SUMS').read_text().splitlines()}
for m in originalManifest:
 if m['path'].startswith('operations/increment68/hosts/refresh42-20261004T1330Z/'+key+'/') and m['path'].endswith(('.js','.mjs','.mts','.py')):
  p=archive/m['path'];digest=sha(p.read_bytes());assert p.is_file() and digest==m['sha256'] and p.stat().st_size==m['byteCount']
  e=extractedByPath[m['path']];assert e['sha256']==digest and e['bytes']==p.stat().st_size and e['validatedAgainstArchiveManifest']
  assert sums[str(p.relative_to(origin))]==digest;verified.append(m)
assert len(verified)==13,len(verified)
stage=(origin/key/'host-stage-functions.js').read_text();configSha=re.search(r'r.payload.sourceConfigSha256!=="([a-f0-9]{64})"',stage).group(1)
assert 'r.payload.sourceId!=="'+sourceId+'"' in stage
oldRoot=oldbase+'/hosts/refresh42-20261004T1330Z/'+key;prefix='restored46:'+key+':'
cfg={'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':sourceId,'sourceConfigSha256':configSha}
files={}
def write(p,body):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with p.open('xb') as f:f.write(body if isinstance(body,bytes) else body.encode())
 p.chmod(0o600)
def save(p,v):write(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def bind(t):
 t=t.replace(oldRoot,str(host)).replace(oldbase+'/producer-source',str(repo)).replace('dot-cloud-restored-fb0b8e3-20261004',candidate).replace('refresh42:'+key+':',prefix)
 t=t.replace('env TSX_DISABLE_CACHE=1 ','env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 ')
 t=t.replace('env JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ','env JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 ')
 t=t.replace("TSX_DISABLE_CACHE: '1',","TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1', PYTHONDONTWRITEBYTECODE: '1',")
 return t

def put(dest,path,transform=bind):
 raw=path.read_bytes();new=transform(raw.decode()).encode();write(host/'originals'/dest,raw);write(host/dest,new)
 dp=host/'diffs'/(dest.replace('/','__')+'.diff');write(dp,''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),fromfile='originals/'+dest,tofile=dest)))
 files[dest]={'origin':str(path),'originalSha256':sha(raw),'sha256':sha(new),'originalPath':str(host/'originals'/dest),'diffPath':str(dp)}
for name in ['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs']:put(name,origin/key/name)
for name in ['continuous-relay-v3-durable-monitor.js','preflight/runtime-check.mjs']:put('runtime/'+name,origin/key/'runtime'/name)
def starter(t):
 t=bind(t);needle=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");';assert t.count(needle)==1
 return t.replace(needle,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");')
put('runtime/start-monitor-true-a42.js',origin/key/'runtime/start-monitor-true-a42.js',starter)
def preflight(t):
 t=bind(t);needle="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)";assert t.count(needle)==1
 return t.replace(needle,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
put('runtime/preflight/preflight-launch.mjs',origin/key/'runtime/preflight/preflight-launch.mjs',preflight)
def state(t):
 t=bind(t);scope="!root.startsWith('"+oldbase+"/hosts/')";assert scope in t and "!/^[a-z0-9-]+$/.test(candidateId)" in t
 return t.replace(scope,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(candidate))
put('runtime/load-host-state.js',origin/key/'runtime/load-host-state.js',state)
def loader(t):
 return 'if(sourceKey!=='+json.dumps(key)+')throw Error("RESTORED46_SOURCE_SELECTION");\n'+bind(t)
put('runtime/load-source-runtime.js',origin/key/'runtime/load-source-runtime.js',loader)
put('runtime/compact-json-review.inc.py',origin/key/'runtime/compact-json-review.inc.py')
def review(t):
 t=bind(t)
 needle="assert req['kind']=='PUBLISH'"
 assert t.count(needle)==1
 assert ('assert cfg[\'sourceId\']=='+json.dumps(sourceId)+' and cfg[\'sourceConfigSha256\']=='+json.dumps(configSha)) in t
 # The relay already verifies these fields; the independent reviewer repeats them without changing source-quality rules.
 marker="scope={'sql':sql};"
 extra="""assert req['schemaVersion']==1 and req['requestId']==rid and re.fullmatch(r'[a-f0-9-]{36}',rid)
body={k:v for k,v in req.items() if k!='requestSha256'}
assert hashlib.sha256(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==req['requestSha256']
assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(req['expiresAt'].replace('Z','+00:00'))
"""
 assert marker in t;t=t.replace(marker,extra+marker)
 return t
put('runtime/review-publication.py',origin/key/'runtime/review-publication.py',review)
save(host/'host-config.json',cfg);save(host/'control-base.json',control)
save(host/'CONFIG_RECONSTRUCTION.json',{'originalHostRoot':oldRoot,'originalSourceId':sourceId,'originalSourceConfigSha256':configSha,'originalConfigBytesAvailable':False,'method':'Reconstructed from original per-source loader/stage literal bindings and current frozen producer canonical registry; original config is absent from the safe extracted MSD source files. No original 36-route runtime configuration is claimed recovered.','sourceStagePath':str(origin/key/'host-stage-functions.js'),'configOmissionRecord':str(base/'verification/code80-minimal-extracted-manifest.json'),'currentControlPath':str(base/'verification/candidate46-input.json')})
save(host/'RESTORATION_MANIFEST.json',{'key':key,'root':str(host),'prefix':prefix,'sourceId':sourceId,'sourceConfigSha256':configSha,'route':'A','heapMiB':384,'starter':'runtime/start-monitor-true-a42.js','startCodeKey':prefix+'restoredASourceStartCode','loader':'runtime/load-source-runtime.js','templateFiles':files,'originalArchiveManifest':str(archive/'FILE_MANIFEST.json'),'originalManifestEntries':verified,'allOriginalManifestHashesVerified':True,'configurationRecreatedAsDocumented':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['ARCHIVE_STORE historical branch is unsupported; preserve only, do not invoke','Preflight CHECK ONLY: its inherited portable diagnostic launch mode/256 MiB command is not the A starter','Synthetic diagnostics are never capture, current DB observation, or launch evidence'],'adaptations':['Current paths and registered C46 identity; no producer, schema or adapter change','Independent restored46 source namespace; exact source loader and candidate scope','Disable caches; strict string batch IDs','Reviewer exact source/config allowlist and independent request identity/hash/expiry checks; original A quality/count/hash gates retained']})
print(json.dumps({'sourceId':sourceId,'sourceConfigSha256':configSha,'route':'A','originalSafeFiles':13,'root':str(host),'notLaunched':True}))
