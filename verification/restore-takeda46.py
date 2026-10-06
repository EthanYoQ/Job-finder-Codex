#!/usr/bin/env python3
"""Restore only the archived Takeda external host. Does not launch, publish or access DB."""
import difflib, hashlib, json, re
from pathlib import Path
base=Path(__file__).resolve().parent.parent
archive=base/'code80-minimal'; origin=archive/'operations/increment68/hosts/refresh42-20261004T1330Z/takeda'
host=base/'hosts46/takeda'; repo=base/'producer42'
assert not host.exists(), 'HOST_ALREADY_EXISTS'
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest_bytes=(archive/'FILE_MANIFEST.json').read_bytes()
assert sha(manifest_bytes)=='a975a3c0abc2d15512c64ad4281d4299a17a0b5ab68aa8961ec4c5de73547bb5'
archived={v['path']:v for v in json.loads(manifest_bytes)}
oldbase='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
oldroot=oldbase+'/hosts/refresh42-20261004T1330Z/takeda'
source='source-takeda-china-social'; prefix='restored46:takeda:'
control=json.loads((base/'verification/candidate46-input.json').read_text())
registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
assert control['candidate']=={'id':registered['id'],'goalId':registered['goalId'],'version':46}
assert control['build']==json.loads((base/'verification/restored-build-identity.json').read_text())
candidate=control['candidate']['id']; assert candidate=='dot-cloud-restored-fb0b8e3-20261005T2028Z'
files={}; verified=[]
def original(path):
    b=path.read_bytes(); m=archived[str(path.relative_to(archive))]
    assert sha(b)==m['sha256'] and len(b)==m['byteCount'],str(path)
    verified.append({'path':str(path),'sha256':sha(b),'bytes':len(b)})
    return b
stage=original(origin/'host-stage-functions.js').decode()
config_sha=re.search(r'r.payload.sourceConfigSha256!=="([a-f0-9]{64})"',stage).group(1)
assert config_sha=='048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f'
assert 'r.payload.sourceId!=="'+source+'"' in stage
prepare=original(origin.parent/'prepare-host.mjs').decode()
assert "takeda:'"+source+"'" in prepare
def write(p,b):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with p.open('xb') as f:f.write(b if isinstance(b,bytes) else b.encode())
    p.chmod(0o600)
def save(p,v):write(p,json.dumps(v,indent=2,ensure_ascii=False)+'\n')
def bind(t):
    t=t.replace(oldroot,str(host)).replace(oldbase+'/producer-source',str(repo))
    t=t.replace('dot-cloud-restored-fb0b8e3-20261004',candidate).replace('refresh42:takeda:',prefix)
    t=t.replace('env TSX_DISABLE_CACHE=1 ','env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
    t=t.replace('env JOBFINDER_CLOUD_SOURCE_ID='+source+' ','env JOBFINDER_CLOUD_SOURCE_ID='+source+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
    t=t.replace("TSX_DISABLE_CACHE: '1',","TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',")
    return t
def put(dest,transform=bind):
    p=origin/dest; raw=original(p); text=transform(raw.decode()); b=text.encode()
    write(host/'originals'/dest,raw);write(host/dest,b)
    dp=host/'diffs'/(dest.replace('/','__')+'.diff')
    write(dp,''.join(difflib.unified_diff(raw.decode().splitlines(True),text.splitlines(True),fromfile='originals/'+dest,tofile=dest)))
    files[dest]={'origin':str(p),'originalPath':str(host/'originals'/dest),'originalSha256':sha(raw),'sha256':sha(b),'diffPath':str(dp)}
for n in ['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs','runtime/continuous-relay-v3-durable-monitor.js','runtime/preflight/runtime-check.mjs','runtime/review-publication.py']:put(n)
def starter(t):
    t=bind(t);a=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))';assert t.count(a)==1
    return t.replace(a,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))')
put('runtime/start-monitor-portable42.js',starter)
def preflight(t):
    t=bind(t);a="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)";assert t.count(a)==1
    return t.replace(a,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
put('runtime/preflight/preflight-launch.mjs',preflight)
def state(t):
    t=bind(t);a="!root.startsWith('"+oldbase+"/hosts/')";assert a in t
    return t.replace(a,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(candidate))
put('runtime/load-host-state.js',state)
def loader(t):return 'if(sourceKey!=="takeda")throw Error("RESTORED46_SOURCE_SELECTION");\n'+bind(t)
put('runtime/load-source-runtime.js',loader)
cfg={'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':source,'sourceConfigSha256':config_sha}
save(host/'host-config.json',cfg);save(host/'control-base.json',control)
save(host/'CONFIG_RECONSTRUCTION.json',{'originalConfigBytesAvailable':False,'method':'Recreated from source-specific archived Takeda stage binding, original prepare-host recipe, and registered C46 control; canonical source plan and recomputed build must pass prepare-takeda46.mjs.','originalHostRoot':oldroot,'sourceConfigSha256':config_sha,'sourceMapPath':str(origin.parent/'prepare-host.mjs'),'sourceStagePath':str(origin/'host-stage-functions.js'),'currentControlPath':str(base/'verification/candidate46-input.json')})
save(host/'RESTORATION_MANIFEST.json',{'schemaVersion':1,'status':'PREPARED_NOT_LAUNCHED','key':'takeda','sourceKey':'takeda','root':str(host),'prefix':prefix,'sourceId':source,'sourceConfigSha256':config_sha,'route':'PORTABLE','heapMiB':256,'starter':'runtime/start-monitor-portable42.js','startCodeKey':prefix+'restoredPortableSourceStartCode','templateFiles':files,'originalArchiveManifest':str(archive/'FILE_MANIFEST.json'),'originalArchiveManifestSha256':sha(manifest_bytes),'originalFilesVerified':verified,'allSelectedOriginalManifestHashesVerified':True,'configurationRecreated':True,'sourceNetworkAccessed':False,'databaseWrites':False,'producerLaunched':False,'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'automaticPublication':False,'inheritedLimitations':['ARCHIVE_STORE inherited branch references absent audit helper; preserve but do not invoke','Use source-specific starter and preflight check; inherited preflight launch is diagnostic only','Historical same-source RUNNING classification belongs to parent; no process is inferred terminated from its age'],'adaptations':['Current local paths and registered C46 identity','Isolated restored46:takeda namespace and exact loader scope','Disable compilation caches','Strict string batch IDs','Original source-bound reviewer preserved, candidate rebound to C46; dynamic counts retained']})
print(json.dumps({'host':str(host),'sourceId':source,'sourceConfigSha256':config_sha,'verifiedOriginalFiles':len(verified),'producerLaunched':False}))
