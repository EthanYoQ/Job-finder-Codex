#!/usr/bin/env python3
"""Offline restoration of the exact Novartis portable heap512 host contract."""
import difflib,hashlib,json,re
from pathlib import Path
R=Path(__file__).resolve().parent.parent;host=R/'hosts46/novartis';repo=R/'producer42'
assert not host.exists(),'ALREADY_PREPARED_OR_ACTIVE'
load=lambda p:json.loads(p.read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
control=load(R/'verification/candidate46-input.json');registered=load(R/'verification/CANDIDATE46_REGISTERED.json')['candidate'];active=load(R/'PUBLISHER-ACTIVE-STATE.json')
assert active['active'] is None and 'novartis' not in {x['sourceKey'] for x in active['pendingReadOnlyTerminalSources']}
assert control['candidate']['version']==registered['version']==active['runtimeCandidate']['version']==46
assert control['candidate']['id']==registered['id']==active['runtimeCandidate']['id']
assert control['build']==load(R/'verification/restored-build-identity.json')
source='source-novartis-social';config='1dcb83b63182c3b496a1137678baae55201276b4e041b60b6cbe1fab30990a91';prefix='restored46:novartis:'
original=R/'code80-next-due-contracts/operations/external-host67';base=original/'hosts/portable42-novartis';heap=R/'code80-next-due-contracts/operations/increment68/hosts/portable42-novartis/runtime-heap512'
manifest=load(original/'FILE_MANIFEST.json');heapManifest=load(heap.parent/'recovery-heap512/HOST_HEAP512_MANIFEST.json')
assert heapManifest['heapOldSpaceMiB']==512 and heapManifest['sourceConfigSha256']==config
oldbase='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z';oldroot=oldbase+'/hosts/portable42-novartis';candidate=control['candidate']['id']
files={};verified=[]
def write(p,b):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with p.open('xb') as f:f.write(b if isinstance(b,bytes) else b.encode())
 p.chmod(0o600)
def save(p,v):write(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def bind(t):
 t=t.replace(oldroot+'/novartis',str(host)).replace(oldroot+'/runtime-heap512',str(host/'runtime')).replace(oldroot,str(host)).replace(oldbase+'/producer-source',str(repo)).replace('dot-cloud-restored-fb0b8e3-20261004',candidate).replace('novartis-context-read.sql','context-read.sql')
 t=re.sub(r'\b(load|store)\(([\'"])([^\'"]+)([\'"])',lambda m:m[1]+'('+m[2]+prefix+m[3]+m[4],t)
 t=t.replace('env TSX_DISABLE_CACHE=1 ','env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 ')
 t=t.replace('env JOBFINDER_CLOUD_SOURCE_ID='+source+' ','env JOBFINDER_CLOUD_SOURCE_ID='+source+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1 ')
 t=t.replace("TSX_DISABLE_CACHE: '1',","TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1', PYTHONDONTWRITEBYTECODE: '1',")
 return t

def put(dest,p,transform=bind):
 raw=p.read_bytes()
 if p.is_relative_to(original):
  entries=[x for x in manifest if x['path']==str(p.relative_to(original))];assert len(entries)==1
  m=entries[0];assert m['sha256']==sha(raw) and m['byteCount']==len(raw)
 else:
  m=heapManifest['files']['runtime-heap512/'+str(p.relative_to(heap))];assert m['sha256']==sha(raw) and m['bytes']==len(raw)
 verified.append({'origin':str(p),'sha256':sha(raw),'bytes':len(raw)})
 new=transform(raw.decode()).encode();write(host/'originals'/dest,raw);write(host/dest,new)
 dp=host/'diffs'/(dest.replace('/','__')+'.diff');write(dp,''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),fromfile='originals/'+dest,tofile=dest)))
 files[dest]={'origin':str(p),'originalSha256':sha(raw),'sha256':sha(new),'originalPath':str(host/'originals'/dest),'diffPath':str(dp)}
for name in ['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs']:put(name,base/'novartis'/name)
for name in ['continuous-relay-v3-durable-monitor.js','preflight/runtime-check.mjs']:put('runtime/'+name,heap/name)
def starter(t):
 t=bind(t);needle=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");';assert t.count(needle)==1
 return t.replace(needle,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");')
put('runtime/start-monitor-portable42.js',heap/'start-monitor-portable42.js',starter)
def preflight(t):
 t=bind(t);needle="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)";assert t.count(needle)==1
 return t.replace(needle,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
put('runtime/preflight/preflight-launch.mjs',heap/'preflight/preflight-launch.mjs',preflight)
def state(t):
 t=bind(t);scope="!root.startsWith('"+oldbase+"/hosts/')";assert scope in t
 return t.replace(scope,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(candidate))
put('runtime/load-host-state.js',heap/'load-host-state.js',state)
def loader(t):
 t=bind(t).replace('base+"/runtime-heap512"','base+"/runtime"').replace("base+'/'+sourceKey","base").replace('PORTABLE42_SOURCE_SELECTION','RESTORED46_SOURCE_SELECTION')
 t+='\nstore("'+prefix+'nextBatchId",null);\n';return t
put('runtime/load-source-runtime.js',heap/'load-portable42-runtime.js',loader)
def review(t):
 t=bind(t);needle="sql=(run/'relay'/f'{request_id}.request.json.sql').read_text();"
 extra="""assert request['schemaVersion']==1
body={k:v for k,v in request.items() if k!='requestSha256'}
assert hashlib.sha256(json.dumps(body,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()==request['requestSha256']
now=datetime.datetime.now(datetime.timezone.utc)
assert now<datetime.datetime.fromisoformat(request['expiresAt'].replace('Z','+00:00'))
assert now<datetime.datetime.fromisoformat(request['payload']['dispatchBefore'].replace('Z','+00:00'))
"""
 assert t.count(needle)==1;t=t.replace(needle,extra+needle)
 marker="assert cert['companyId']=='company-novartis'"
 assert marker in t
 t=t.replace(marker,"assert hashlib.sha256(json.dumps(cert,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()==row['completenessCertificateSha256']\n"+marker)
 return t
put('runtime/review-publication.py',heap/'review-portable-publication.py',review)
assert len(files)==12
cfg={'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':source,'sourceConfigSha256':config}
save(host/'host-config.json',cfg);save(host/'control-base.json',control)
save(host/'CONFIG_RECONSTRUCTION.json',{'originalConfigBytesAvailable':False,'method':'Exact Novartis source literals plus current frozen producer canonical registry; original configs omitted from source backup; registered C46 control retained only as inert template','originalHostRoot':oldroot+'/novartis','originalRuntimeRoot':str(heap),'sourceId':source,'sourceConfigSha256':config,'noOld36RouteRuntimeClaimed':True})
save(host/'RESTORATION_MANIFEST.json',{'key':'novartis','root':str(host),'prefix':prefix,'sourceId':source,'sourceConfigSha256':config,'route':'PORTABLE','heapMiB':512,'starter':'runtime/start-monitor-portable42.js','startCodeKey':prefix+'restoredPortableSourceStartCode','loader':'runtime/load-source-runtime.js','templateFiles':files,'originalManifestEntries':verified,'allOriginalManifestHashesVerified':True,'configurationRecreatedAsDocumented':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['Legacy ARCHIVE_STORE unsupported; do not invoke','Preflight CHECK ONLY; exact real starter supplies DB_STARTED control','Synthetic checks are not real captures or launch authority'],'adaptations':['C46 exact identity/current paths and isolated restored46 namespace','Cache disabling and string batch ID gate','Reviewer own source/config, request integrity and expiry, certificate hash; original quality/count gates retained'],'observedSamplerRestored':False,'originalCaptureEntrypointAndHeapRetained':True})
print(json.dumps({'root':str(host),'source':source,'heapMiB':512,'originalSafeFiles':len(files),'notLaunched':True}))
