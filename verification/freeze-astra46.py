#!/usr/bin/env python3
"""Freeze only the Astra46 host, using exact local identity, schema and lock proof."""
from pathlib import Path
import datetime,hashlib,json,re
base=Path(__file__).resolve().parent.parent;host=base/'hosts46/astra';repo=base/'producer42'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
def save(p,x):
    with p.open('x') as f:json.dump(x,f,ensure_ascii=False,indent=2);f.write('\n')
    p.chmod(0o400)
spec=load(host/'SPEC.json');checks=load(host/'CHECK_RESULTS.json');source=load(host/'SOURCE_CHECK_RESULTS.json');detail=load(host/'DETAIL_BOUNDARY_CHECKS.json');identity=load(host/'IDENTITY_PROOF.json')
assert all(x['passed'] for x in [checks,source,detail])
assert checks['checks'][-1]['passed'] and len(checks['checks'])==16
assert len(source['checks'])==5 and len(detail['checks'])==6
assert identity['allIdentityFieldsEqual'] and identity['frozenGitClean']
registered=load(base/'verification/CANDIDATE46_REGISTERED.json')['candidate'];control=load(base/'verification/candidate46-input.json')
assert load(host/'control-base.json')==control
assert spec['candidate']==control['candidate'] and spec['build']==control['build']
assert spec['route']=='A' and spec['heapMiB']==384 and spec['hostRevision']==2 and spec['sourceAdmissionPolicy'] is None
assert spec['sourceId']=='source-astrazeneca-social' and spec['prefix']=='restored46:astra:'
frozen=[]
def add(p):
    p=Path(p);assert p.is_file() and not p.is_symlink()
    if p not in frozen:frozen.append(p)
for name,v in spec['templateFiles'].items():
    assert sha((host/name).read_bytes())==v['sha256'] and sha(Path(v['originalPath']).read_bytes())==v['originalSha256']
    add(host/name);add(v['originalPath']);add(v['diffPath'])
originals=load(base/'code80-astra-contracts/COMPLETE_ORIGINAL_MANIFEST.json')
for r in originals:
    p=host/'originals'/Path(r['path']).relative_to('hosts/astra42')
    assert sha(p.read_bytes())==r['sha256'] and p.stat().st_size==r['byteCount'];add(p)
pfpath=Path(next(c['reportPath'] for c in checks['checks'] if 'reportPath' in c));pf=load(pfpath)
smoke=pf['runtime']['archiveSmoke'];artifact=Path(smoke['workspaceRoot'])/smoke['path']
assert artifact.stat().st_size==smoke['byteCount'] and sha(artifact.read_bytes())==smoke['sha256'] and smoke['qualification'] is False
assert pf['localChecksPassed'] and not pf['launchPermitted'] and pf['noNetworkDuringPreflight'] and pf['noDatabaseDuringPreflight']
testid=pfpath.parent.parent.name.removeprefix('_local-preflight-');relay=host/('NONQUAL-CONTROL-astra-'+testid)/'relay'
controls=list(relay.glob('*.request.json.control.json'));assert len(controls)==1
cp=controls[0];sp=cp.with_name(cp.name.removesuffix('.control.json')+'.sql');sql=sp.read_text()
migrations=json.loads(re.search(r"jsonb_to_recordset\(E'(\[\{\"checksum\".*?\])'::jsonb\)",sql).group(1))
assert len(migrations)==48 and len({m['migrationName'] for m in migrations})==48
for m in migrations:assert sha((repo/'prisma/migrations'/m['migrationName']/'migration.sql').read_bytes())==m['checksum']
candidate=json.loads(re.search(r'jsonb_populate_record\(NULL::public\."ReleaseCandidate",E\'(.*?)\'::jsonb\)',sql).group(1))
for k,v in candidate.items():assert registered[k]==v,(k,registered[k],v)
required=['BEGIN;','COMMIT;','FOR UPDATE;','LOCK TABLE public."_prisma_migrations" IN SHARE MODE;','PILOT_SQL45_GUARD_DRIFT','PILOT_MIGRATION_HISTORY','PILOT_CANDIDATE_DRIFT','PILOT_SOURCE_CONFIG_DRIFT','CRAWL_LEASE_LOST','PILOT_REQUEST_EXPIRED']
for token in required:assert token in sql,token
assert load(cp)['expiresAt']!=control['expiresAt']
stage=(host/'host-stage-functions.js').read_text();relaycode=(host/'relay-files.mjs').read_text();helper=(host/'host-helper-functions.js').read_text();starter=(host/spec['starter']).read_text();loader=(host/'runtime/load-host-state.js').read_text()
assert 'if(r.expired||r.dispatchRecorded)throw Error("HOST_STALE_OR_UNCERTAIN_REQUEST:"+r.kind)' in stage
assert "state:'MAY_HAVE_BEEN_SENT'" in relaycode and "reason:'DISPATCH_UNCERTAIN'" in relaycode and "{flag:'wx',mode:0o600}" in relaycode
assert "outcome:'UNKNOWN'" in helper and 'POLL_UNRESOLVED_NO_RETRY' in helper
assert 'if(typeof batch!=="string"||' in starter and 'id=\'formal-crawl\'' in starter and 'row.holderId!==""' in starter
for t in [helper,starter,(host/'runtime/load-source-runtime.js').read_text(),loader]:assert 'TSX_DISABLE_CACHE=1 NODE_DISABLE_COMPILE_CACHE=1 PYTHONDONTWRITEBYTECODE=1' in t
assert control['candidate']['id'] in starter and 'candidateId!=="'+control['candidate']['id']+'"' in loader
originalStarter=(host/'originals'/spec['starter']).read_text()
gate=lambda t:t.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0]
assert gate(starter)==gate(originalStarter)
guard={'schemaVersion':1,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'passed':True,'scope':'OFFLINE_ASTRA46_SCHEMA_IDENTITY_LOCK_AND_HASH_AUDIT','candidate':spec['candidate'],'sourceId':spec['sourceId'],'sourceConfigSha256':spec['sourceConfigSha256'],'original19FilesHashVerified':True,'originalRevision2BatchTypeGuard':True,'originalCrawlObservation12hGateByteEqual':True,'strictAGradeOriginalContext':True,'originalClockMs':1800000,'contextDeadlineOffsetMs':1635000,'contextDispatchOffsetMs':1610000,'exactMigrationCount':48,'allMigrationChecksumsMatchFrozenProducer':True,'compiledSqlCandidateMatchesRegistered46':True,'migrationGuardAndRowLockPreserved':True,'expiredOrUncertainDispatchGuardPreserved':True,'cspcContextRereadAdded':False,'originalInertExpiryRetained':control['expiresAt'],'freshLocalFixtureExpiryUsed':True,'cacheDisabledForNodeImports':True,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'launchAuthorizedByThisReport':False,'preflightReport':str(pfpath),'nonqualifyingCreatePendingSql':str(sp),'checks':{'host':len(checks['checks']),'source':len(source['checks']),'detailBoundary':len(detail['checks'])}}
save(host/'GUARD_CHECKS.json',guard)
for name in ['host-config.json','control-base.json','CONFIG_RECONSTRUCTION.json','RESTORATION_MANIFEST.json','SPEC.json','source-plan.json','context-read.sql','CHECK_RESULTS.json','SOURCE_CHECK_RESULTS.json','DETAIL_BOUNDARY_CHECKS.json','IDENTITY_PROOF.json','GUARD_CHECKS.json','PREPARED.json','RUNBOOK.md']:add(host/name)
for name in ['restore-astra46.py','prepare-astra46.mjs','check-astra46.mjs','check-astra46-source.mjs','check-astra46-detail-boundary.mjs','finalize-astra46-identity.mjs','freeze-astra46.py']:add(base/'verification'/name)
for name in ['EXTRACTED_MANIFEST.json','COMPLETE_ORIGINAL_MANIFEST.json']:add(base/'code80-astra-contracts'/name)
for name in ['ORIGINAL_FILE_MANIFEST.json','SNAPSHOT_STATE.json','ROLE_MANIFESTS.json','README.md']:add(base/'code80-astra-contracts/operations/increment78'/name)
for path in [pfpath,artifact,cp,sp]:add(path)
records=[{'path':str(p.relative_to(base)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(frozen)]
save(host/'FROZEN_MANIFEST.json',{'schemaVersion':1,'status':'FROZEN_OFFLINE_PREPARED_NOT_LAUNCHED','frozenAt':guard['checkedAt'],'sourceId':spec['sourceId'],'candidate':spec['candidate'],'originalSafeSourceFileCount':19,'hostChecks':16,'sourceChecks':5,'detailBoundaryChecks':6,'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'freshDBReadRequired':True,'files':records})
frozen.append(host/'FROZEN_MANIFEST.json')
with (host/'SOURCE_BACKUP_FILELIST.txt').open('x') as f:f.write('\n'.join(str(p.relative_to(base)) for p in sorted(frozen))+'\n')
with (host/'SOURCE_BACKUP_SHA256SUMS').open('x') as f:f.write(''.join(sha(p.read_bytes())+'  '+str(p.relative_to(base))+'\n' for p in sorted(frozen)))
for p in frozen:
    if p.is_relative_to(host) and not any(x.startswith(('_local-preflight-','NONQUAL-')) for x in p.relative_to(host).parts):p.chmod(0o400)
(host/'SOURCE_BACKUP_FILELIST.txt').chmod(0o400);(host/'SOURCE_BACKUP_SHA256SUMS').chmod(0o400)
print(json.dumps({'passed':True,'sourceId':spec['sourceId'],'frozenFiles':len(frozen),'checks':guard['checks'],'originalSourceFiles':19,'migrationCount':48,'producerLaunched':False,'sha256sums':str(host/'SOURCE_BACKUP_SHA256SUMS')}))
