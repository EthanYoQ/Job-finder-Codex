#!/usr/bin/env python3
"""Restore the archived AstraZeneca r2 host offline with source-scoped C46 bindings."""
import difflib, hashlib, json, re, tarfile
from pathlib import Path

base=Path(__file__).resolve().parent.parent
repo=base/'producer42'; host=base/'hosts46/astra'
archive=base/'downloads/job-finder-clean-code-recovery-v80-20261005T1718Z.tar.gz'
original=base/'code80-astra-contracts/operations/increment78/hosts/astra42'
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(archive.read_bytes())=='efa5fd32158d3b9e858c6941c419a3bb3694db9f2922dc20eef91a108cc02eab'
assert not host.exists()
records=[r for r in json.loads((base/'code80-astra-contracts/operations/increment78/ORIGINAL_FILE_MANIFEST.json').read_text()) if r['role']=='astra42-host-r2']
assert len(records)==19 and sum(r['byteCount'] for r in records)==97324
def write(path,body):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with path.open('xb') as f:f.write(body if isinstance(body,bytes) else body.encode())
    path.chmod(0o600)
def save(path,value):write(path,json.dumps(value,ensure_ascii=False,indent=2)+'\n')
with tarfile.open(archive) as tf:
    for r in records:
        data=tf.extractfile(r['archivePath']).read()
        assert sha(data)==r['sha256'] and len(data)==r['byteCount']
        dest=original/Path(r['path']).relative_to('hosts/astra42')
        if dest.exists():assert dest.read_bytes()==data
        else:write(dest,data)
save(base/'code80-astra-contracts/COMPLETE_ORIGINAL_MANIFEST.json',records)
oldbase='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
oldroot=oldbase+'/hosts/astra42'
control=json.loads((base/'verification/candidate46-input.json').read_text())
registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
assert control['candidate']['id']==registered['id'] and control['candidate']['version']==registered['version']==46
assert control['build']==json.loads((base/'verification/restored-build-identity.json').read_text())
recipe=(original/'prepare-host.mjs').read_text()
source=re.search("const sourceId='([^']+)',expectedConfig='([^']+)',prefix='([^']+)';",recipe)
sourceId,configHash,oldprefix=source.groups();prefix='restored46:astra:'
assert sourceId=='source-astrazeneca-social' and oldprefix=='astra42:'
assert sha((original/'runtime/start-monitor-true-a42.js').read_bytes())=='891841b278f2f9e20611305f095ee2e3e512e9670ebeefd2c4d8dfd9ded9673d'
assert 'if(typeof batch!=="string"||' in (original/'runtime/start-monitor-true-a42.js').read_text()
files={}
def bind(text):
    return text.replace(oldroot,str(host)).replace(oldbase+'/producer-source',str(repo)).replace('dot-cloud-restored-fb0b8e3-20261004',control['candidate']['id']).replace(oldprefix,prefix)
runtimeNames=['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs','runtime-loader.js','runtime/continuous-relay-v3-durable-monitor.js','runtime/load-host-state.js','runtime/load-source-runtime.js','runtime/review-publication.py','runtime/compact-json-review.inc.py','runtime/start-monitor-true-a42.js','runtime/preflight/preflight-launch.mjs','runtime/preflight/runtime-check.mjs']
for r in records:
    name=str(Path(r['path']).relative_to('hosts/astra42'));raw=(original/name).read_bytes()
    write(host/'originals'/name,raw)
    if name not in runtimeNames:continue
    adapted=bind(raw.decode())
    if name=='runtime/load-host-state.js':
        oldscope="!root.startsWith('"+oldbase+"/hosts/')"
        assert oldscope in adapted and "!/^[a-z0-9-]+$/.test(candidateId)" in adapted
        adapted=adapted.replace(oldscope,'root!=='+json.dumps(str(host))).replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(control['candidate']['id']))
    data=adapted.encode();write(host/name,data)
    delta=host/'diffs'/(name.replace('/','__')+'.diff')
    write(delta,''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),adapted.splitlines(keepends=True),fromfile='originals/'+name,tofile=name)))
    files[name]={'origin':str(archive)+':'+r['archivePath'],'originalStorage':r['storage'],'originalSha256':sha(raw),'sha256':sha(data),'originalPath':str(host/'originals'/name),'template':str(host/'originals'/name),'templateSha256':sha(raw),'diffPath':str(delta)}
save(host/'host-config.json',{'root':str(host),'repo':str(repo),'project':control['projectId'],'sourceId':sourceId,'sourceConfigSha256':configHash})
save(host/'control-base.json',control)
save(host/'CONFIG_RECONSTRUCTION.json',{'method':'Current configuration derived from archived Astra r2 prepare-host source binding and the separately supplied registered C46 control. No historical config, control, plan, queue, or identity bytes invented. Canonical plan and compiled SQL must pass local rederivation before use.','originalRecipe':str(original/'prepare-host.mjs'),'originalSourceId':sourceId,'originalSourceConfigSha256':configHash,'originalConfigBytesAvailable':False,'currentControl':str(base/'verification/candidate46-input.json'),'registrationReadback':str(base/'verification/CANDIDATE46_REGISTERED.json'),'freshDatabaseReadPerformed':False})
save(host/'RESTORATION_MANIFEST.json',{'key':'astra','sourceKey':'astra','root':str(host),'prefix':prefix,'sourceId':sourceId,'sourceConfigSha256':configHash,'route':'A','heapMiB':384,'starter':'runtime/start-monitor-true-a42.js','startCodeKey':prefix+'restoredASourceStartCode','hostRevision':2,'originalRevision2StarterSha256':sha((original/'runtime/start-monitor-true-a42.js').read_bytes()),'templateFiles':files,'originalSources':records,'originalArchiveManifest':str(base/'code80-astra-contracts/COMPLETE_ORIGINAL_MANIFEST.json'),'all19OriginalManifestHashesVerified':True,'exactOriginalLibraryBytesRestored':True,'originalGitBackupCommit':'a6eb76823c7ff91cb675828b3cf1e397491fca50','githubReadPerformed':False,'configurationRecreatedAsDocumented':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','inheritedLimitations':['Legacy preflight is check-only for A; its launch mode is not the A launcher','ARCHIVE_STORE is unsupported; preserved source is not an authorization to invoke it','Synthetic diagnostics are never capture, database readback, due-time or launch evidence'],'adaptations':['Current local host and producer paths','Registered C46 candidate and exact source-specific loader binding','Independent restored46:astra: namespace'],'sourceRouteOrPolicyChanged':False,'cspcContextRereadAdded':False})
print(json.dumps({'root':str(host),'sourceId':sourceId,'sourceConfigSha256':configHash,'originalFilesVerified':len(records),'notLaunched':True}))
