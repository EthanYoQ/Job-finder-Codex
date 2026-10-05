#!/usr/bin/env python3
"""Recover original external-host66 PORTABLE contracts, one source per frozen directory."""
import difflib,hashlib,json,re,sys
from pathlib import Path
base=Path(__file__).resolve().parent.parent;root=base/'hosts46';repo=base/'producer42'
archive=base/'code80-portable66-contracts/operations/external-host66';origin=archive/'hosts/portable42'
oldbase='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
selection={'astellas':'source-astellas-china-social','grifols':'source-grifols-china-social','bms':'source-bms-china-social','biogen':'source-biogen-china-social'}
key=sys.argv[1];assert key in selection;sourceId=selection[key];host=root/key;assert not host.exists()
control=json.loads((base/'verification/candidate46-input.json').read_text());registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate'];candidate=control['candidate']['id']
assert candidate==registered['id'] and control['candidate']['version']==registered['version']==46
assert control['build']==json.loads((base/'verification/restored-build-identity.json').read_text())
manifest=json.loads((archive/'FILE_MANIFEST.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
for m in manifest:
 p=archive/Path(m['archivePath']).relative_to('operations/external-host66');assert p.is_file() and sha(p.read_bytes())==m['sha256'] and p.stat().st_size==m['byteCount']
# Source/config/path binding is present in the original source-specific archived stages.
stage=(origin/key/'host-stage-functions.js').read_text();configSha=re.search(r'r.payload.sourceConfigSha256!=="([a-f0-9]{64})"',stage).group(1)
assert 'r.payload.sourceId!=="'+sourceId+'"' in stage
assert key+':\''+sourceId+'\'' in (origin/'prepare-host.mjs').read_text()
oldRoot=oldbase+'/hosts/portable42/'+key;prefix='restored46:'+key+':'
# The package intentionally omits configs and expressly requires their recreation from authorized values.
cfg={'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':sourceId,'sourceConfigSha256':configSha}
files={}
def write(p,body):
 p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with p.open('xb') as f:f.write(body if isinstance(body,bytes) else body.encode())
 p.chmod(0o600)
def save(p,v):write(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def bind(t):
 t=t.replace(oldRoot,str(host)).replace(oldbase+'/hosts/portable42/runtime',str(host/'runtime')).replace(oldbase+'/producer-source',str(repo)).replace('dot-cloud-restored-fb0b8e3-20261004',candidate)
 t=re.sub(r'\b(load|store)\(([\"\x27])([^\"\x27]+)\2',lambda m:m[1]+'('+m[2]+prefix+m[3]+m[2],t)
 t=t.replace('env TSX_DISABLE_CACHE=1 ','env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
 t=t.replace('env JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' ','env JOBFINDER_CLOUD_SOURCE_ID='+sourceId+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
 t=t.replace("TSX_DISABLE_CACHE: '1',","TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',")
 t=t.replace('/qilu-context-read.sql','/context-read.sql')
 return t

def put(dest,path,transform=bind):
 raw=path.read_bytes();new=transform(raw.decode()).encode();write(host/'originals'/dest,raw);write(host/dest,new)
 diff=''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),fromfile='originals/'+dest,tofile=dest));dp=host/'diffs'/(dest.replace('/','__')+'.diff');write(dp,diff)
 files[dest]={'origin':str(path),'originalSha256':sha(raw),'sha256':sha(new),'originalPath':str(host/'originals'/dest),'diffPath':str(dp)}
for name in ['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs']:put(name,origin/key/name)
for name in ['continuous-relay-v3-durable-monitor.js','preflight/runtime-check.mjs']:put('runtime/'+name,origin/'runtime'/name)
def start(t):
 t=bind(t);needle=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");';assert t.count(needle)==1
 return t.replace(needle,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");')
put('runtime/start-monitor-portable42.js',origin/'runtime/start-monitor-portable42.js',start)
def preflight(t):
 t=bind(t);needle="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)";assert t.count(needle)==1
 return t.replace(needle,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
put('runtime/preflight/preflight-launch.mjs',origin/'runtime/preflight/preflight-launch.mjs',preflight)
def state(t):
 t=bind(t);scope="!root.startsWith('"+oldbase+"/hosts/')";assert scope in t and "!/^[a-z0-9-]+$/.test(candidateId)" in t
 return t.replace(scope,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(candidate))
put('runtime/load-host-state.js',origin/'runtime/load-host-state.js',state)
def loader(t):
 t=bind(t).replace(oldbase+'/hosts/portable42',str(root));t=re.sub(r'const selections=\{[^;]+;', 'const selections='+json.dumps({key:sourceId})+';',t)
 t=t.replace('q(base+"/runtime")','q(base+"/"+sourceKey+"/runtime")').replace('PORTABLE42_SOURCE_SELECTION','RESTORED46_SOURCE_SELECTION')
 needle="store('"+prefix+"currentRetainedCaptureInput',null);";assert needle in t
 return t.replace(needle,needle+"\nstore('"+prefix+"nextBatchId',null);")
put('runtime/load-source-runtime.js',origin/'runtime/load-portable42-runtime.js',loader)
put('runtime/review-publication.py',archive/'host-runtime/review-portable-publication.py')
save(host/'host-config.json',cfg);save(host/'control-base.json',control)
save(host/'CONFIG_RECONSTRUCTION.json',{'originalHostRoot':oldRoot,'originalSourceId':sourceId,'originalSourceConfigSha256':configSha,'originalConfigBytesAvailable':False,'method':'Regenerated current config per original prepare-host.mjs recipe and RESTORE_LIMITATIONS.json; source/config binding copied from archived source-specific stage and revalidated against current canonical plan.','sourceMapPath':str(origin/'prepare-host.mjs'),'sourceStagePath':str(origin/key/'host-stage-functions.js'),'configOmissionRecord':str(archive/'RESTORE_LIMITATIONS.json'),'currentControlPath':str(base/'verification/candidate46-input.json')})
save(host/'RESTORATION_MANIFEST.json',{'key':key,'root':str(host),'prefix':prefix,'sourceId':sourceId,'sourceConfigSha256':configSha,'route':'PORTABLE','heapMiB':256,'starter':'runtime/start-monitor-portable42.js','startCodeKey':prefix+'restoredPortableSourceStartCode','templateFiles':files,'originalArchiveManifest':str(archive/'FILE_MANIFEST.json'),'allOriginalManifestHashesVerified':True,'configurationRecreatedAsDocumented':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['ARCHIVE_STORE historical branch is unsupported; preserve only, do not invoke','Use source-specific starter and preflight check; inherited preflight launch mode is a diagnostic template','Synthetic diagnostics are never capture or launch evidence'],'adaptations':['Current local paths and registered C46 identity','Independent restored46 source namespace and source-specific loader scope','Disable compilation caches','Strict string batch IDs and stale nextBatchId clearing as in already recovered hosts','Rename legacy qilu-context-read.sql path to context-read.sql only']})
print(json.dumps({'sourceId':sourceId,'sourceConfigSha256':configSha,'route':'PORTABLE','sourceOriginal':str(origin/key),'root':str(host),'notLaunched':True}))
