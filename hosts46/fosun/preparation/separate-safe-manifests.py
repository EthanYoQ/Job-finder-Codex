#!/usr/bin/env python3
"""Finalize strict source-only allowlists; keep all operational/check payloads private."""
import hashlib,json
from pathlib import Path
BASE=Path(__file__).resolve().parents[3]
SHA=lambda b:hashlib.sha256(b).hexdigest()
def save(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n');path.chmod(0o600)
for key in ['fosun','kelun','bi']:
    host=BASE/'hosts46'/key
    manifest=json.loads((host/'SAFE_SOURCE_MANIFEST.json').read_text())
    removed=[item for item in manifest['files'] if item['role']=='synthetic-check-summary']
    safe=[item for item in manifest['files'] if item['role']!='synthetic-check-summary']
    if key=='fosun':
        for path in [Path(__file__).resolve(),host/'preparation/check-launch-guards.mjs']:
            rel=str(path.relative_to(BASE));safe=[x for x in safe if x['path']!=rel]
            safe.append({'path':rel,'role':'offline-check-source','sha256':SHA(path.read_bytes()),'byteCount':path.stat().st_size})
    # Final source scope deliberately excludes even synthetic output summaries.
    for item in safe:
        path=BASE/item['path'];data=path.read_bytes()
        assert path.is_file() and not path.is_symlink() and path.is_relative_to(host)
        assert item['role'] in ['source','original-source','source-diff','offline-check-source','source-runbook']
        assert path.suffix in ['.js','.mjs','.mts','.py','.diff','.md']
        item['sha256']=SHA(data);item['byteCount']=len(data)
    manifest['files']=sorted(safe,key=lambda x:x['path'])
    manifest['scope']='CLOSED_ALLOWLIST_RUNTIME_SOURCE_ORIGINALS_DIFFS_OFFLINE_CHECK_CODE_NEUTRAL_RUNBOOK_ONLY'
    manifest['excludedCategories']=['actual configuration and identity','all generated SQL','all diagnostic/check output payloads including synthetic summaries','real runs','source captures','database payloads']
    manifest['privateBindingsIndex']='PRIVATE_RUNTIME_BINDINGS.json'
    save(host/'SAFE_SOURCE_MANIFEST.json',manifest)
    (host/'SAFE_SOURCE_FILELIST.txt').write_text('\n'.join(x['path'] for x in manifest['files'])+'\n')
    (host/'SAFE_SOURCE_SHA256SUMS').write_text(''.join(x['sha256']+'  '+x['path']+'\n' for x in manifest['files']))
    actual=json.loads((host/'ACTUAL_IDENTITY_MANIFEST.json').read_text())
    for item in actual['files']:
        data=(BASE/item['path']).read_bytes();item['sha256']=SHA(data);item['byteCount']=len(data)
    save(host/'ACTUAL_IDENTITY_MANIFEST.json',actual)
    private={x['path']:{**x,'role':'LOCAL_CONFIGURATION_OR_OPERATIONAL_IDENTITY'} for x in actual['files']}
    for item in removed:private[item['path']]={**item,'role':'PRIVATE_SYNTHETIC_CHECK_OUTPUT'}
    for name in ['CHECK_RESULTS.json','SAFETY_COUNTEREXAMPLES.json','CONTRACT_CHECKS.json','REVIEWER_CHECKS.json','GUARD_CHECKS.json','LAUNCH_GUARD_TEST_RESULTS.json']:
        path=host/name;data=path.read_bytes();rel=str(path.relative_to(BASE))
        private[rel]={'path':rel,'role':'PRIVATE_SYNTHETIC_CHECK_OUTPUT','sha256':SHA(data),'byteCount':len(data)}
    privateRoots=[p for p in host.iterdir() if p.is_dir() and (p.name.startswith('NONQUAL-') or p.name.startswith('_local-preflight-'))]
    privateRoots.append(host/'preparation/NONQUAL-REVIEWER-CASES')
    privateFiles=[p for p in host.iterdir() if p.is_file() and p.name.startswith('NON_QUALIFYING_BOOTSTRAP-')]
    symlinks=[]
    for root in privateRoots:
        assert root.is_relative_to(host) and not root.is_symlink()
        for path in root.rglob('*'):
            if path.is_symlink():
                symlinks.append({'path':str(path.relative_to(BASE)),'role':'PRIVATE_SYNTHETIC_SYMLINK_DIAGNOSTIC','includedPayload':False})
            elif path.is_file():privateFiles.append(path)
    for path in privateFiles:
        data=path.read_bytes();rel=str(path.relative_to(BASE))
        private[rel]={'path':rel,'role':'PRIVATE_GENERATED_SQL_OR_NONQUALIFYING_DIAGNOSTIC_PAYLOAD','sha256':SHA(data),'byteCount':len(data)}
    assert not set(private).intersection(x['path'] for x in safe)
    save(host/'PRIVATE_RUNTIME_BINDINGS.json',{'schemaVersion':1,'sourceKey':key,'scope':'LOCAL_ONLY_OPERATIONAL_BINDINGS_AND_NONQUALIFYING_DIAGNOSTICS_EXCLUDED_FROM_SAFE_SOURCE','files':sorted(private.values(),key=lambda x:x['path']),'excludedSymlinks':symlinks,'sourceCapturesPresent':False,'realDatabaseReadbackPresent':False,'realProducerRunsPresent':False,'automaticBackupAllowed':False})
    print(json.dumps({'sourceKey':key,'safeSourceFiles':len(safe),'privateIndexedFiles':len(private),'diagnosticSymlinksExcluded':len(symlinks)}))
