"""Restore and verify a pinned source package. No runtime entrypoint is executed."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, re

V = 'verification/released-native-requirements-20261007T1548Z'
R = Path('/workspace/scratch/5e9614251709/jb-incremental-proxy-runtime-20261007T0057Z')
COMMIT = '28402a299bb04cbf5873da66c2fe8ca76827c0d1'
NAMESPACES = ['hosts/pfizer','owner-adaptations/pfizer-b-20261007T1548Z',V]
sha = lambda b: hashlib.sha256(b).hexdigest()

def require(condition, reason):
    if not condition: raise ValueError(reason)

def keys(value, expected, name):
    require(isinstance(value, dict) and set(value) == set(expected), 'EXACT_KEYS:'+name)

def clean_path(value):
    require(isinstance(value,str) and value and '\\' not in value, 'RELATIVE_PATH')
    p = PurePosixPath(value)
    require(not p.is_absolute() and '..' not in p.parts and str(p)==value, 'RELATIVE_PATH')
    return value

def no_symlinks(path):
    for p in [path, *path.parents]: require(not p.is_symlink(), 'SYMLINK_FORBIDDEN')

def static_inputs(d):
    keys(d,['schemaVersion','producerCommit','sourceId','route','sourceConfigSha256','sourceConfig','currentSourcePlan','implementationSha256'],'static-inputs')
    require(d['schemaVersion']==1 and d['producerCommit']==COMMIT, 'STATIC_IDENTITY')
    require(d['sourceId']=='source-pfizer-china-social' and d['route']=='TRUE_B', 'STATIC_ROUTE')
    require(d['sourceConfigSha256']=='84aaab8bad3579630eec1b12d3f09236755b3a25d0b7751ca8584a9a53a83413','STATIC_CONFIG_HASH')
    sc=d['sourceConfig'];keys(sc,['id','companyId','kind','atsKind','status','officialEntryUrl','officialChainEvidenceUrl'],'sourceConfig')
    p=d['currentSourcePlan']
    keys(p,['adapterId','company','source','executionAuthority','expectedChannels','expectedChannelSetHash','json','workday','transientRetryPolicy','transportPolicy'],'currentSourcePlan')
    keys(p['company'],['id','officialChineseName','category'],'company')
    keys(p['source'],[*sc,'surfaceId'],'plan.source')
    require(all(p['source'][k]==v for k,v in sc.items()),'SOURCE_CONFIG_PLAN_MISMATCH')
    require(sc['id']==d['sourceId'] and p['company']['id']==sc['companyId'],'SOURCE_ID')
    require(isinstance(p['expectedChannels'],list) and len(p['expectedChannels'])==1,'CHANNELS')
    keys(p['expectedChannels'][0],['channelId','kind'],'channel')
    keys(p['json'],['jobsPath','fields','defaultCategory'],'json')
    keys(p['json']['fields'],['sourceJobId','officialTitle','officialUrl','locationRaw','cities','officialPublishedAt'],'fields')
    keys(p['workday'],['tenant','traversalScopePolicy','site','laterZeroTotalPolicy','appliedFacets','pageSize','maxPages'],'workday')
    keys(p['workday']['appliedFacets'],['Location_Country'],'facets')
    keys(p['transientRetryPolicy'],['maxRetries','backoffMs'],'retry')
    keys(p['transportPolicy'],['primary'],'transport')
    require(isinstance(d['implementationSha256'],dict) and len(d['implementationSha256'])>0,'IMPLEMENTATION_PINS')
    for path,h in d['implementationSha256'].items():
        clean_path(path);require(isinstance(h,str) and re.fullmatch('[a-f0-9]{64}',h),'IMPLEMENTATION_HASH')

def load_package(root, expected, source_scope_only=False):
    no_symlinks(root)
    require(re.fullmatch('[a-f0-9]{64}',expected) is not None,'PINNED_MANIFEST_SHA_REQUIRED')
    mp=root/V/'restore-manifest.json';no_symlinks(mp);raw=mp.read_bytes()
    require(sha(raw)==expected,'RESTORE_MANIFEST_HASH_MISMATCH')
    m=json.loads(raw);keys(m,['schemaVersion','staticInputsPath','staticInputsSha256','files'],'restore-manifest')
    require(m['schemaVersion']==1 and m['staticInputsPath']==V+'/static-inputs.json','MANIFEST_SCHEMA')
    payload={};rows={}
    require(isinstance(m['files'],list) and m['files'],'MANIFEST_FILES')
    for row in m['files']:
        keys(row,['path','mode','bytes','sha256'],'file')
        rel=clean_path(row['path']);require(rel not in rows,'DUPLICATE_PATH')
        require(any(rel.startswith(prefix+'/') for prefix in NAMESPACES),'OUTSIDE_SOURCE_NAMESPACE')
        require(rel!=V+'/restore-manifest.json' and row['mode']=='100644','MANIFEST_MODE')
        require(type(row['bytes']) is int and row['bytes']>=0,'FILE_SIZE')
        require(isinstance(row['sha256'],str) and re.fullmatch('[a-f0-9]{64}',row['sha256']),'FILE_SHA')
        path=root/rel;no_symlinks(path);b=path.read_bytes()
        require(len(b)==row['bytes'] and sha(b)==row['sha256'],'FILE_BYTES:'+rel)
        payload[rel]=b;rows[rel]=row
    payload[V+'/restore-manifest.json']=raw
    actual=set()
    scan_roots=[root/ns for ns in NAMESPACES] if source_scope_only else [root]
    for scan_root in scan_roots:
        no_symlinks(scan_root)
        for path in scan_root.rglob('*'):
            require(not path.is_symlink(),'PACKAGE_SYMLINK')
            if path.is_file(): actual.add(str(path.relative_to(root)))
    require(actual==set(payload),'PACKAGE_FILE_SET')
    b=payload[m['staticInputsPath']];require(sha(b)==m['staticInputsSha256'],'STATIC_INPUT_HASH')
    d=json.loads(b);static_inputs(d)
    ref=json.loads(payload['hosts/pfizer/host/source-config-reference.json'])
    keys(ref,['sourceId','route','sourceConfigSha256','source'],'source-reference')
    require(ref=={k:(d['sourceConfig'] if k=='source' else d[k]) for k in ref},'SOURCE_REFERENCE')
    proof=json.loads(payload['hosts/pfizer/host/context-template-proof.json'])
    require(proof['originalSourcePlan']==d['currentSourcePlan'],'FULL_PLAN_MISMATCH')
    require(proof['candidate'] is None and proof['databaseIdentity'] is None,'BOUND_PROOF')
    require(proof['contextSha256']==sha(payload['hosts/pfizer/host/context-read.sql.template']),'CONTEXT_BYTES')
    for name in ['control-base.template.json','owner-binding-input.template.json']:
        cfg=json.loads(payload['hosts/pfizer/host/'+name])
        require(cfg['candidate'] is None and cfg['databaseIdentity'] is None,'BOUND_TEMPLATE')
    for name in payload:
        require(not any(x in PurePosixPath(name).parts for x in ['activation.json','control-base.json','current-run.json']),'ACTUAL_STATE_FORBIDDEN')
    baseline=json.loads(payload['owner-adaptations/pfizer-b-20261007T1548Z/baseline-manifest.json'])
    require(baseline['producerCommit']==COMMIT and baseline['runtimeRoot']==str(R),'BASELINE_IDENTITY')
    require(len(baseline['files'])==5,'BASELINE_SET')
    for absolute,entry in baseline['files'].items():
        rel=str(Path(absolute).relative_to(R));b=payload[rel]
        require(entry=={'sha256':sha(b),'bytes':len(b)},'BASELINE_BYTES')
    return payload

def output_path(value, source, fresh):
    p=Path(value);require(p.is_absolute() and '..' not in p.parts,'ABSOLUTE_OUTPUT_REQUIRED')
    no_symlinks(p)
    for forbidden in [R/'hosts',R/'owner-adaptations',R/'producer',R/'runtime',source]:
        require(not p.is_relative_to(forbidden) and not forbidden.is_relative_to(p),'PROTECTED_OUTPUT')
    require(p.exists()!=fresh,'NEW_OUTPUT_REQUIRED' if fresh else 'OUTPUT_MISSING')
    return p

def main(mode, script):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True);parser.add_argument('--manifest-sha256',required=True)
    args=parser.parse_args();root=Path(script).resolve().parents[2]
    payload=load_package(root,args.manifest_sha256,source_scope_only=True)
    out=output_path(args.output,root,mode=='restore')
    if mode=='restore':
        out.mkdir(parents=True,exist_ok=False)
        for rel,b in sorted(payload.items()):
            p=out/rel;p.parent.mkdir(parents=True,exist_ok=True)
            with p.open('xb') as f:f.write(b)
            p.chmod(0o644)
    compared=load_package(out,args.manifest_sha256)
    require(payload==compared,'RESTORED_BYTES_DIFFER')
    print(json.dumps({'operation':mode,'sourceFiles':len(payload),'exactBytes':True,'output':str(out),'runtimeExecuted':False,'network':False,'database':False}))
