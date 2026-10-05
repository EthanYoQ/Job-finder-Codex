#!/usr/bin/env python3
"""Recover four original external hosts locally; no DB, websites, launches or uploads."""
import difflib, hashlib, json
from pathlib import Path

base=Path(__file__).resolve().parent.parent
root=base/'hosts46';repo=base/'producer42'
cache_path=base/'verification/session-cache-late-source-recovery.json'
cache=json.loads(cache_path.read_text())
control=json.loads((base/'verification/candidate46-input.json').read_text())
registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
candidate=control['candidate']['id'];original_candidate='dot-cloud-restored-fb0b8e3-20261004'
assert candidate==registered['id'] and control['candidate']['version']==registered['version']==46
assert control['build']==json.loads((base/'verification/restored-build-identity.json').read_text())
archive=base/'code80-minimal/operations/increment70/hosts/refresh42-20261004T1600Z'
sha=lambda b:hashlib.sha256(b).hexdigest()
def write(p,body):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with p.open('xb') as f:f.write(body if isinstance(body,bytes) else body.encode())
    p.chmod(0o600)
def save(p,obj):write(p,json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
all_manifests={}
for key in ['cspc','amgen','abbvie','cttq']:
    src=cache['sources'][key];old=src['cloudPilotHostConfig'];host=root/key;origin=archive/key
    prefix='restored46:'+key+':'
    route='A' if key in ['amgen','cttq'] else 'PORTABLE'
    starter='runtime/start-monitor-'+('true-a42' if route=='A' else 'portable42')+'.js'
    start_key='restoredASourceStartCode' if route=='A' else 'restoredPortableSourceStartCode'
    files={};comparisons={}
    def bind(t):
        t=t.replace(old['root'],str(host)).replace(old['repo'],str(repo)).replace(original_candidate,candidate).replace('refresh42late:'+key+':',prefix)
        t=t.replace('env TSX_DISABLE_CACHE=1 ', 'env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
        t=t.replace('env JOBFINDER_CLOUD_SOURCE_ID='+old['sourceId']+' ', 'env JOBFINDER_CLOUD_SOURCE_ID='+old['sourceId']+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
        t=t.replace("TSX_DISABLE_CACHE: '1',", "TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',")
        return t
    def put(dest,body,provenance,transform=bind):
        raw=body.encode() if isinstance(body,str) else body;new=transform(raw.decode()).encode()
        write(host/'originals'/dest,raw);write(host/dest,new)
        diff=''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),fromfile='originals/'+dest,tofile=dest))
        delta=host/'diffs'/(dest.replace('/','__')+'.diff');write(delta,diff)
        files[dest]={'origin':provenance,'originalSha256':sha(raw),'sha256':sha(new),'originalPath':str(host/'originals'/dest),'diffPath':str(delta)}
    def bind_starter(t):
        t=bind(t);needle=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");'
        assert t.count(needle)==1
        return t.replace(needle,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");')
    for ck,dest in [('cloudPilotHostHelpers','host-helper-functions.js'),('cloudPilotHostStages','host-stage-functions.js'),('continuousPortableRelayCodeWithPoll','runtime/continuous-relay-v3-durable-monitor.js'),(start_key,starter)]:
        raw=src[ck].encode();archived=(origin/dest).read_bytes();assert raw==archived,(key,dest)
        comparisons[dest]={'sessionCacheSha256':sha(raw),'archiveSha256':sha(archived),'byteEqual':True,'archivePath':str(origin/dest)}
        put(dest,raw,str(cache_path)+':sources.'+key+'.'+ck,bind_starter if dest==starter else bind)
    for dest in ['host-files.mts','relay-files.mjs','archive-transfer.mjs','runtime/load-source-runtime.js','runtime/review-publication.py','runtime/preflight/preflight-launch.mjs','runtime/preflight/runtime-check.mjs']+(['runtime/compact-json-review.inc.py'] if route=='A' else []):
        def adapt(t):
            t=bind(t)
            if dest=='runtime/preflight/preflight-launch.mjs':
                needle="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)"
                assert t.count(needle)==1
                t=t.replace(needle,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
            return t
        put(dest,(origin/dest).read_bytes(),str(origin/dest),adapt)
    def loader(t):
        t=bind(t);scope="!root.startsWith('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/')"
        assert scope in t and "!/^[a-z0-9-]+$/.test(candidateId)" in t
        return t.replace(scope,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(candidate))
    put('runtime/load-host-state.js',(origin/'runtime/load-host-state.js').read_bytes(),str(origin/'runtime/load-host-state.js'),loader)
    save(host/'originals/host-config.json',old)
    save(host/'host-config.json',{**old,'root':str(host),'repo':str(repo)})
    save(host/'control-base.json',control)
    manifest={'key':key,'root':str(host),'prefix':prefix,'sourceId':old['sourceId'],'sourceConfigSha256':old['sourceConfigSha256'],'route':route,'heapMiB':384 if route=='A' else 256,'starter':starter,'startCodeKey':prefix+start_key,'templateFiles':files,'sessionCacheArchiveComparisons':comparisons,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['ARCHIVE_STORE historical branch is unsupported; preserve only, do not invoke','Use source-specific starter and preflight check; inherited preflight launch route is a portable diagnostic template','Synthetic diagnostics are never capture or launch evidence']}
    save(host/'RESTORATION_MANIFEST.json',manifest);all_manifests[key]=manifest
original=(archive/'runtime/load-refresh42-runtime.js').read_text()
new=original.replace('/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/refresh42-20261004T1600Z/',str(root)+'/').replace('REFRESH42_','RESTORED46_')
write(root/'originals/load-late46-runtime.js',original);write(root/'runtime/load-late46-runtime.js',new)
write(root/'diffs/load-late46-runtime.js.diff',''.join(difflib.unified_diff(original.splitlines(keepends=True),new.splitlines(keepends=True),fromfile='originals/load-late46-runtime.js',tofile='runtime/load-late46-runtime.js')))
save(root/'LATE46_RESTORATION_MANIFEST.json',{'status':'RESTORED_PENDING_LOCAL_VERIFICATION','candidate':control['candidate'],'build':control['build'],'cacheSha256':sha(cache_path.read_bytes()),'sources':all_manifests,'notLaunched':True})
print(json.dumps({'restored':list(all_manifests),'root':str(root),'notLaunched':True}))
