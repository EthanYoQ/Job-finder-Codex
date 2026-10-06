#!/usr/bin/env python3
"""Offline exact-source increment68 host recovery; never launches or calls a database."""
import datetime, difflib, hashlib, json, re
from pathlib import Path

BASE = Path(__file__).resolve().parents[3]
ROOT = BASE / 'hosts46'
ARCHIVE = BASE / 'code80-minimal'
ORIGIN = ARCHIVE / 'operations/increment68/hosts/refresh42-20261004T1330Z'
OLD_BASE = '/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z'
SOURCES = {
    'fosun': ('source-fosun-pharma-social', '0227ec8d384900a48b2973f128908f7e9435d4bc991efd9a5b14ea5a3d1042b2'),
    'kelun': ('source-kelun-social', '9fe0cb0d7c308567f6010aa6181f36c595b97df739ecd528cab97070f47572cb'),
    'bi': ('source-boehringer-ingelheim-china-social', '86abb89ac25980acc5e9e3c82741a3415138f53f321f1050c4ae849efd4132de'),
}
SHA = lambda b: hashlib.sha256(b).hexdigest()
MANIFEST = {m['path']: m for m in json.loads((ARCHIVE/'FILE_MANIFEST.json').read_text())}
control = json.loads((BASE/'verification/candidate46-input.json').read_text())
registered = json.loads((BASE/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
active = json.loads((BASE/'PUBLISHER-ACTIVE-STATE.json').read_text())
assert control['candidate']['id'] == registered['id'] == active['runtimeCandidate']['id']
assert control['candidate']['version'] == registered['version'] == active['runtimeCandidate']['version'] == 46
assert control['build'] == json.loads((BASE/'verification/restored-build-identity.json').read_text())
assert control['build']['commitSha'] == 'fb0b8e3b708d4f57cae09b465fb1c9ceddf7ad8d'
assert control['build']['runtimeTreeSha256'] == 'fed1104297227bd870188af0b2e6fcf11c1d43f306df3feb8458fbfc13d2290f'
assert active['active'] is None
assert not set(SOURCES).intersection(x['sourceKey'] for x in active['pendingReadOnlyTerminalSources'])
for key in SOURCES:
    host=ROOT/key
    assert not host.exists() or (key=='fosun' and {p.name for p in host.iterdir()} == {'preparation'})

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    data=value if isinstance(value, bytes) else value.encode()
    with path.open('xb') as f: f.write(data)
    path.chmod(0o600)

def save(path, value): write(path, json.dumps(value, ensure_ascii=False, indent=2)+'\n')

def original(path):
    assert path.is_file() and not path.is_symlink()
    data=path.read_bytes(); item=MANIFEST[str(path.relative_to(ARCHIVE))]
    assert len(data)==item['byteCount'] and SHA(data)==item['sha256']
    return data

recipe=original(ORIGIN/'prepare-host.mjs')
for key,(source, config) in SOURCES.items():
    host=ROOT/key; old_root=OLD_BASE+'/hosts/refresh42-20261004T1330Z/'+key
    prefix='restored46:'+key+':'
    stage=original(ORIGIN/key/'host-stage-functions.js').decode()
    assert 'r.payload.sourceId!=="'+source+'"' in stage
    assert 'r.payload.sourceConfigSha256!=="'+config+'"' in stage
    assert key+":'"+source+"'" in recipe.decode()
    files={}

    def bind(t):
        return (t.replace(old_root,str(host)).replace(OLD_BASE+'/producer-source',str(BASE/'producer42'))
            .replace('dot-cloud-restored-fb0b8e3-20261004',control['candidate']['id'])
            .replace('refresh42:'+key+':',prefix)
            .replace('env TSX_DISABLE_CACHE=1 ','env TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
            .replace('env JOBFINDER_CLOUD_SOURCE_ID='+source+' ','env JOBFINDER_CLOUD_SOURCE_ID='+source+' TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 ')
            .replace("TSX_DISABLE_CACHE: '1',","TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',"))

    def transform(dest,t):
        t=bind(t)
        if dest=='runtime/start-monitor-portable42.js':
            needle=';if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");'
            assert t.count(needle)==1
            t=t.replace(needle,';if(typeof batch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(batch))throw Error("BATCH_ID");')
        if dest=='runtime/preflight/preflight-launch.mjs':
            needle="|| !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)"
            assert t.count(needle)==1
            t=t.replace(needle,"|| typeof bootstrap.batchId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(bootstrap.batchId)")
        if dest=='runtime/load-host-state.js':
            needle="!root.startsWith('"+OLD_BASE+"/hosts/')"
            assert needle in t
            t=t.replace(needle,'root!=='+json.dumps(str(host)))
            t=t.replace("!/^[a-z0-9-]+$/.test(sourceId)",'sourceId!=='+json.dumps(source))
            t=t.replace("!/^[a-z0-9-]+$/.test(candidateId)",'candidateId!=='+json.dumps(control['candidate']['id']))
            t=t.replace("!/^[a-f0-9]{40}$/.test(commit)",'commit!=='+json.dumps(control['build']['commitSha']))
        if dest=='runtime/load-source-runtime.js':
            t='if(sourceKey!=='+json.dumps(key)+')throw Error("RESTORED46_SOURCE_SELECTION");\n'+t
        if dest=='runtime/review-publication.py':
            # Keep this source's own exact config and policy, and dynamic count equality.
            assert 'assert cfg[\'sourceId\']=="'+source+'" and cfg[\'sourceConfigSha256\']=="'+config+'"' in t
            assert "cert['counts']['rawCount']==row['rawCount']" in t
        return t

    names=['host-helper-functions.js','host-stage-functions.js','host-files.mts','relay-files.mjs','archive-transfer.mjs',
           'runtime/load-host-state.js','runtime/load-source-runtime.js','runtime/start-monitor-portable42.js',
           'runtime/continuous-relay-v3-durable-monitor.js','runtime/review-publication.py',
           'runtime/preflight/preflight-launch.mjs','runtime/preflight/runtime-check.mjs']
    for dest in names:
        src=ORIGIN/key/dest; raw=original(src); changed=transform(dest,raw.decode()).encode()
        write(host/'originals'/dest,raw); write(host/dest,changed)
        diff=''.join(difflib.unified_diff(raw.decode().splitlines(keepends=True),changed.decode().splitlines(keepends=True),fromfile='originals/'+dest,tofile=dest))
        dp=host/'diffs'/(dest.replace('/','__')+'.diff'); write(dp,diff)
        files[dest]={'origin':str(src),'originalSha256':SHA(raw),'sha256':SHA(changed),'originalPath':str(host/'originals'/dest),'diffPath':str(dp)}
    save(host/'host-config.json',{'root':str(host),'repo':str(BASE/'producer42'),'project':control['projectId'],'sourceId':source,'sourceConfigSha256':config})
    save(host/'control-base.json',control)
    save(host/'CONFIG_RECONSTRUCTION.json',{'sourceId':source,'sourceConfigSha256':config,'originalConfigBytesAvailable':False,'method':'Recreated from verified original increment68 prepare-host recipe, source-specific stage binding, current canonical producer plan, and registered C46 control; original code retained independently.','originalPrepareRecipe':str(ORIGIN/'prepare-host.mjs'),'originalPrepareRecipeSha256':SHA(recipe),'currentControlPath':str(BASE/'verification/candidate46-input.json')})
    save(host/'RESTORATION_MANIFEST.json',{'key':key,'root':str(host),'prefix':prefix,'sourceId':source,'sourceConfigSha256':config,'route':'PORTABLE','heapMiB':256,'starter':'runtime/start-monitor-portable42.js','startCodeKey':prefix+'restoredPortableSourceStartCode','templateFiles':files,'originalArchiveManifest':str(ARCHIVE/'FILE_MANIFEST.json'),'allSelectedOriginalManifestHashesVerified':True,'configurationRecreatedAsDocumented':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'originalControlExpiryRetainedAsInertTemplate':control['expiresAt'],'requiresFreshActualObservationBootstrap':True,'requiresSinglePublisher':True,'archiveRetention':'SEPARATE_AUTHORIZED_PARENT_STEP','adaptations':['Current paths and registered C46 identity','Own restored46 namespace and exact source/root/candidate/commit loader binding','Disable compilation caches','Strict string batch IDs, matching existing recovered hosts','Original own-source reviewer retained, dynamic counts and certificate bindings unchanged'],'inheritedLimitations':['ARCHIVE_STORE historical branch is preserved but unsupported; do not invoke','Direct preflight launch is a diagnostic template; use source-specific starter','Synthetic checks cannot authorize capture/publication']})
    for name in ['prepare-portable66-next-host46.mjs','check-portable66-next-host46.mjs','check-portable66-next-safety46.mjs']:
        template=BASE/'verification'/name
        text=template.read_text().replace("['merck','gilead','organon']","['fosun','kelun','bi']")
        text=text.replace("dirname(dirname(fileURLToPath(import.meta.url)))",json.dumps(str(BASE)))
        write(host/'preparation'/name,text)
    save(host/'preparation/ORIGINAL_INPUTS.json',{'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalRecipeSha256':SHA(recipe),'selectedFilesVerified':len(names),'sourceId':source,'sourceConfigSha256':config,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False})
    print(json.dumps({'key':key,'sourceId':source,'originalFilesVerified':len(names),'notLaunched':True}))
