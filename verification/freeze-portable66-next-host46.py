#!/usr/bin/env python3
"""Read-only host/source audit and source-only backup index, excluding all live runs."""
from pathlib import Path
import datetime, hashlib, json, re, sys

base=Path(__file__).resolve().parent.parent;root=base/'hosts46';repo=base/'producer42'
sha=lambda b:hashlib.sha256(b).hexdigest()
registered=json.loads((base/'verification/CANDIDATE46_REGISTERED.json').read_text())['candidate']
control=json.loads((base/'verification/candidate46-input.json').read_text())
report={'schemaVersion':1,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'READ_ONLY_LOCAL_HOST_AND_NONQUALIFYING_DIAGNOSTIC_AUDIT','sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'sources':{}}
filelist=set()
def add(path):
    path=Path(path);assert path.is_file() and not path.is_symlink();filelist.add(str(path.relative_to(base)))
key=sys.argv[1];assert key in ['merck','gilead','organon']
for key in [key]:
    host=root/key;spec=json.loads((host/'SPEC.json').read_text());checks=json.loads((host/'CHECK_RESULTS.json').read_text())
    assert checks['passed'] and len(checks['checks'])==15
    assert json.loads((host/'control-base.json').read_text())==control
    for dest,v in spec['templateFiles'].items():
        assert sha((host/dest).read_bytes())==v['sha256'],(key,dest)
        assert sha(Path(v['originalPath']).read_bytes())==v['originalSha256']
        add(host/dest);add(v['originalPath']);add(v['diffPath'])
    for name in ['CONFIG_RECONSTRUCTION.json','host-config.json','control-base.json','SPEC.json','RESTORATION_MANIFEST.json','source-plan.json','context-read.sql','CHECK_RESULTS.json','PREPARED.json','NEXT_DUE_REFERENCE.json','SAFETY_COUNTEREXAMPLES.json']:add(host/name)
    preflight_path=Path(next(c['reportPath'] for c in checks['checks'] if 'reportPath' in c));pf=json.loads(preflight_path.read_text())
    smoke=pf['runtime']['archiveSmoke'];artifact=Path(smoke['workspaceRoot'])/smoke['path'];data=artifact.read_bytes()
    assert len(data)==smoke['byteCount'] and sha(data)==smoke['sha256'] and smoke['qualification'] is False
    assert pf['localChecksPassed'] and pf['launchPermitted'] is False and pf['noNetworkDuringPreflight'] and pf['noDatabaseDuringPreflight']
    test_id=preflight_path.parent.parent.name.removeprefix('_local-preflight-')
    local_control_dir=host/('NONQUAL-CONTROL-'+key+'-'+test_id)/'relay'
    controls=list(local_control_dir.glob('*.request.json.control.json'));assert len(controls)==1
    control_path=controls[0];sql_path=control_path.with_name(control_path.name.removesuffix('.control.json')+'.sql');sql=sql_path.read_text()
    migrations=json.loads(re.search(r"jsonb_to_recordset\(E'(\[\{\"checksum\".*?\])'::jsonb\)",sql).group(1))
    assert len(migrations)==48 and len({m['migrationName'] for m in migrations})==48
    for m in migrations:assert sha((repo/'prisma/migrations'/m['migrationName']/'migration.sql').read_bytes())==m['checksum']
    sql_candidate=json.loads(re.search(r'jsonb_populate_record\(NULL::public\."ReleaseCandidate",E\'(.*?)\'::jsonb\)',sql).group(1))
    for k,v in sql_candidate.items():assert registered[k]==v,(key,k)
    for token in ['BEGIN;','COMMIT;','FOR UPDATE;','LOCK TABLE public."_prisma_migrations" IN SHARE MODE;', 'PILOT_SQL45_GUARD_DRIFT','PILOT_MIGRATION_HISTORY','PILOT_CANDIDATE_DRIFT','PILOT_SOURCE_CONFIG_DRIFT','CRAWL_LEASE_LOST','PILOT_REQUEST_EXPIRED']:
        assert token in sql,(key,token)
    assert json.loads(control_path.read_text())['expiresAt']!=control['expiresAt']
    stage=(host/'host-stage-functions.js').read_text();relay=(host/'relay-files.mjs').read_text();helper=(host/'host-helper-functions.js').read_text()
    assert 'if(r.expired||r.dispatchRecorded)throw Error("HOST_STALE_OR_UNCERTAIN_REQUEST:"+r.kind)' in stage
    assert "state:'MAY_HAVE_BEEN_SENT'" in relay and "reason:'DISPATCH_UNCERTAIN'" in relay and "{flag:'wx',mode:0o600}" in relay
    assert "outcome:'UNKNOWN'" in helper and 'POLL_UNRESOLVED_NO_RETRY' in helper
    assert 'TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1' in helper and 'TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1' in (host/spec['starter']).read_text()
    report['sources'][key]={'passed':True,'sourceId':spec['sourceId'],'route':spec['route'],'heapMiB':spec['heapMiB'],'checks':15,'sourceConfigSha256':spec['sourceConfigSha256'],'currentSourcePlanAndCandidateIdentity':True,'exactMigrationCount':48,'allMigrationChecksumsMatchFrozenProducer':True,'compiledSqlCandidateMatchesRegistered46':True,'migrationGuardAndRowLockPreserved':True,'expiredOrUncertainDispatchGuardPreserved':True,'originalInertExpiryRetained':control['expiresAt'],'freshLocalFixtureExpiryUsed':True,'cacheDisabledForNodeImports':True,'independentArchive':{'reportPath':str(preflight_path),'artifactPath':str(artifact),'sha256':sha(data),'byteCount':len(data),'qualification':False},'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False}
    for path in [preflight_path,artifact,control_path,sql_path]:add(path)
report_path=host/'GUARD_CHECKS.json'
with report_path.open('x') as f:json.dump(report,f,ensure_ascii=False,indent=2);f.write('\n')
for p in ['verification/restore-portable66-next-host46.py','verification/prepare-portable66-next-host46.mjs','verification/check-portable66-next-host46.mjs','verification/check-portable66-next-safety46.mjs','verification/freeze-portable66-next-host46.py','verification/portable66-original-extracted-manifest.json','verification/CANDIDATE46_REGISTERED.json','verification/restored-build-identity.json','verification/candidate46-input.json']:add(base/p)
add(report_path)
add(host/'RUNBOOK.md')
archive=base/'code80-portable66-contracts/operations/external-host66'
for p in [archive/'FILE_MANIFEST.json',archive/'RESTORE_LIMITATIONS.json',archive/'hosts/portable42-next/prepare-host.mjs']:
    add(p)
for item in spec['templateFiles'].values():add(item['origin'])
names=sorted(filelist)
with (host/'SOURCE_BACKUP_FILELIST.txt').open('x') as f:f.write('\n'.join(names)+'\n')
with (host/'SOURCE_BACKUP_SHA256SUMS').open('x') as f:f.write(''.join(sha((base/n).read_bytes())+'  '+n+'\n' for n in names))
print(json.dumps({'sources':list(report['sources']),'allPassed':True,'sourceFiles':len(names),'filelist':str(host/'SOURCE_BACKUP_FILELIST.txt'),'sha256sums':str(host/'SOURCE_BACKUP_SHA256SUMS'),'databaseAccessed':False,'producerLaunched':False}))
