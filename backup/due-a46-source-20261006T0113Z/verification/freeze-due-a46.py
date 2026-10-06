#!/usr/bin/env python3
"""Freeze verified local hosts separately from a strictly source-only backup selection."""
import datetime,hashlib,json,re,tarfile
from pathlib import Path
R=Path(__file__).resolve().parent.parent;keys=['sph','csl','lilly','daiichi','cr'];sha=lambda b:hashlib.sha256(b).hexdigest();load=lambda p:json.loads(p.read_text())
control=load(R/'verification/candidate46-input.json');registered=load(R/'verification/CANDIDATE46_REGISTERED.json')['candidate'];audit=load(R/'verification/due-a46-contract-audit.json');allSafe=[];summaries=[]
now=load(R/'hosts46/sph/GUARD_CHECKS.json')['checkedAt'] if (R/'hosts46/sph/GUARD_CHECKS.json').exists() else datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(p,s):
 if p.exists():
  assert p.read_text()==s,('EXISTING_OUTPUT_DIFFERS',str(p));return
 with p.open('x') as f:f.write(s)
def save(p,v):write(p,json.dumps(v,ensure_ascii=False,indent=2)+'\n')
manifest84=R/'backup84-safe-increment/ORIGINAL_FILE_MANIFEST.json';m84=load(manifest84)
# Later backup provenance is examined without reading its live/config/evidence payloads.
manifest84matches=[x for x in m84 if any('/hosts46/'+k+'/' in str(x) or '/true-a42-next/'+k+'/' in str(x) for k in keys)] if isinstance(m84,list) else []
assert not manifest84matches,'LATER_SOURCE_OVERRIDE_REQUIRES_REVIEW'
for key in keys:
 host=R/'hosts46'/key;spec=load(host/'SPEC.json');checks=load(host/'CHECK_RESULTS.json');safety=load(host/'SAFETY_COUNTEREXAMPLES.json');review=load(host/'REVIEWER_TEST_RESULTS.json');launch=load(host/'LAUNCH_GUARD_TEST_RESULTS.json');identity=load(host/'IDENTITY_PROOF.json')
 assert all(x['passed'] for x in [checks,safety,review,launch]) and identity['allIdentityFieldsEqual'] and identity['frozenGitClean']
 assert len(checks['checks'])==15 and len(safety['checks'])==6 and len(launch['checks'])==4 and review['totalCases']==49 and review['acceptedCases']==2 and review['rejectedCases']==47
 assert spec['candidate']==control['candidate'] and spec['build']==control['build'] and spec['route']=='A' and spec['heapMiB']==384
 assert load(host/'control-base.json')==control
 pfpath=Path(next(c['reportPath'] for c in checks['checks'] if 'reportPath' in c));pf=load(pfpath);smoke=pf['runtime']['archiveSmoke'];artifact=Path(smoke['workspaceRoot'])/smoke['path']
 assert sha(artifact.read_bytes())==smoke['sha256'] and artifact.stat().st_size==smoke['byteCount'] and smoke['qualification'] is False
 assert pf['localChecksPassed'] and not pf['launchPermitted'] and pf['noNetworkDuringPreflight'] and pf['noDatabaseDuringPreflight']
 testid=pfpath.parent.parent.name.removeprefix('_local-preflight-');relay=host/('NONQUAL-CONTROL-'+key+'-'+testid)/'relay'
 controls=list(relay.glob('*.request.json.control.json'));assert len(controls)==1;cp=controls[0];sp=cp.with_name(cp.name.removesuffix('.control.json')+'.sql');sql=sp.read_text()
 migrations=json.loads(re.search(r"jsonb_to_recordset\(E'(\[\{\"checksum\".*?\])'::jsonb\)",sql).group(1));assert len(migrations)==48 and len({m['migrationName'] for m in migrations})==48
 for m in migrations:assert sha((R/'producer42/prisma/migrations'/m['migrationName']/'migration.sql').read_bytes())==m['checksum']
 candidate=json.loads(re.search(r'jsonb_populate_record\(NULL::public\."ReleaseCandidate",E\'(.*?)\'::jsonb\)',sql).group(1))
 for k,v in candidate.items():assert registered[k]==v,(key,k)
 for token in ['BEGIN;','COMMIT;','FOR UPDATE;','LOCK TABLE public."_prisma_migrations" IN SHARE MODE;','PILOT_SQL45_GUARD_DRIFT','PILOT_MIGRATION_HISTORY','PILOT_CANDIDATE_DRIFT','PILOT_SOURCE_CONFIG_DRIFT','CRAWL_LEASE_LOST','PILOT_REQUEST_EXPIRED']:assert token in sql,token
 starter=(host/spec['starter']).read_text();originalStarter=(host/'originals'/spec['starter']).read_text();gate=lambda t:t.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0]
 assert gate(starter)==gate(originalStarter) and 'if(typeof batch!=="string"||' in starter and 'row.holderId!==""' in starter and '--max-old-space-size=384' in starter and '60000' in starter
 for path,v in spec['templateFiles'].items():assert sha((host/path).read_bytes())==v['sha256'] and sha(Path(v['originalPath']).read_bytes())==v['originalSha256']
 guard={'schemaVersion':1,'passed':True,'checkedAt':now,'sourceId':spec['sourceId'],'sourceConfigSha256':spec['sourceConfigSha256'],'candidate':spec['candidate'],'exactMigrationCount':48,'migrationChecksumsMatch':True,'compiledCandidateMatches46':True,'unchanged12hCrawlObservationGate':True,'heapMiB':384,'publicationMode':'DB_STARTED_OWNER_V1','bootstrapMaxAgeMs':60000,'evidenceClockMs':1800000,'dispatchTransportReserveMs':165000,'completionReserveMs':25000,'exclusiveDispatchRaceVerified':True,'uncertainDispatchNoRetryVerified':True,'occupiedCoordinatorAndExpiredBootstrapRejected':True,'archiveWriteReadHashVerified':True,'archiveSampleSha256':smoke['sha256'],'sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'launchAuthorized':False,'code84ManifestSha256':sha(manifest84.read_bytes()),'code84SupersedingSourceEntries':0,'originalConfigRecovered':False,'original36RouteRuntimeRecovered':False}
 save(host/'GUARD_CHECKS.json',guard)
 sourceAudit=next(s for s in audit['sources'] if s['sourceId']==spec['sourceId']) if isinstance(audit['sources'],list) else audit['sources'][key]
 save(host/'SOURCE_CONTRACT_AUDIT.json',sourceAudit)
 runbook=f'''# {key} C46 TRUE_A recovered host

Status: offline prepared and verified; never launched by these checks. This host uses `{spec['sourceId']}`, `{spec['sourceConfigSha256']}`, C46 `{control['candidate']['id']}`, commit `{control['build']['commitSha']}`. Source/runtime/dependency identity is unchanged.

The 11 original per-source code files and 2 common reviewer/parser files match the code80 external-host67 manifest. No later code84 override exists for these source templates. Original configs/control/context were intentionally omitted from the backup: config is reconstructed from original source literals plus the frozen canonical registry; control uses registered C46; context SQL is recompiled. No original 36-route runtime file is claimed restored.

Load `runtime/load-source-runtime.js` as an AsyncFunction with `sourceKey='{key}'`. It clears stale launch inputs and installs only `{spec['prefix']}` state. Set a fresh unique string batch ID at `{spec['prefix']}nextBatchId`; the source starter lives at `{spec['startCodeKey']}`. Only the designated parent publisher may review/start, after its own fresh candidate/lock/unique successful CrawlObservation read. Approximate due hints are not authority. No batch or bootstrap here is reusable for a real launch.

The original TRUE_A path remains `scripts/p0-cloud-source-pilot.ts --db-started-control`: 384 MiB heap, HTTP timeout 45000 ms, fresh bootstrap <=60000 ms, original 12h actual crawledAt gate, 30-minute source evidence window, 165-second dispatch/transport and 25-second completion reserves. `preflight-launch.mjs` is CHECK ONLY: its historical portable/256 MiB launch mode must not launch this A source. Retained captures are rejected by the actual A pilot.

Official totals and current job membership must come from fresh source responses and unchanged frozen source replay. Historical counts are not targets. SPH uses per-record Beisen detail proofs, Lilly native Workday apply-page proofs, CSL conditional native detail validation, and Daiichi/CR preserve native list/count/ID evidence plus derived detail routes. Daiichi/CR do not independently fetch every apply page. CR's existing zero-total rejection is preserved.

PUBLISH stops at AWAITING_PARENT_REVIEW; original atomic SQL48 compiler, formal-crawl lock, exclusive dispatch, expired-undispatched settlement and uncertain-dispatch no retry remain. Legacy ARCHIVE_STORE and its missing historical audit companion are unsupported; retention remains the parent's separately authorized workflow. The actual archive smoke test uses the frozen producer archive code and passed write/read/hash.

Validation: 15 host checks, 6 safety groups, 4 actual-starter negative cases, 2 legal dynamic-count reviewer positive cases and 47 reviewer negatives. Positive certificates also pass the frozen producer's complete certificate receipt schema/equations. Tests never requested a source, executed SQL, or launched a producer; NONQUAL and _local-preflight files are only synthetic diagnostics. `FROZEN_MANIFEST.json` records private host bindings, while `SOURCE_BACKUP_FILELIST.txt` excludes actual configs, plans, SQL, readbacks, bootstraps, runs and raw evidence. Confirm source checksums before use.
'''
 write(host/'RUNBOOK.md',runbook)
 private=[]
 for name in ['host-config.json','control-base.json','source-plan.json','context-read.sql','CONFIG_RECONSTRUCTION.json','SPEC.json','PREPARED.json','RESTORATION_MANIFEST.json','CHECK_RESULTS.json','SAFETY_COUNTEREXAMPLES.json','REVIEWER_TEST_RESULTS.json','LAUNCH_GUARD_TEST_RESULTS.json','IDENTITY_PROOF.json','GUARD_CHECKS.json','SOURCE_CONTRACT_AUDIT.json','RUNBOOK.md']:
  private.append(host/name)
 safe=[host/'RUNBOOK.md']
 for name,v in spec['templateFiles'].items():safe.extend([host/name,Path(v['originalPath']),Path(v['diffPath'])])
 allFiles=sorted(set(private+safe));records=[{'path':str(p.relative_to(R)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in allFiles]
 frozen={'schemaVersion':1,'status':'FROZEN_OFFLINE_PREPARED_NOT_LAUNCHED','frozenAt':now,'sourceId':spec['sourceId'],'sourceConfigSha256':spec['sourceConfigSha256'],'candidate':spec['candidate'],'checks':{'host':15,'safetyGroups':6,'starterNegatives':4,'reviewerPositive':2,'reviewerNegative':47},'configurationReconstructed':True,'freshDBReadRequired':True,'automaticPublication':False,'files':records}
 save(host/'FROZEN_MANIFEST.json',frozen)
 write(host/'FROZEN_SHA256SUMS',''.join(sha(p.read_bytes())+'  '+str(p.relative_to(R))+'\n' for p in allFiles+[host/'FROZEN_MANIFEST.json']))
 # Deliberately omit runtime config, source plans, full spec/readbacks and all diagnostic payloads from source backup.
 write(host/'SOURCE_BACKUP_FILELIST.txt','\n'.join(str(p.relative_to(R)) for p in sorted(safe))+'\n')
 write(host/'SOURCE_BACKUP_SHA256SUMS',''.join(sha(p.read_bytes())+'  '+str(p.relative_to(R))+'\n' for p in sorted(safe)))
 allSafe.extend(safe+[host/'SOURCE_BACKUP_FILELIST.txt',host/'SOURCE_BACKUP_SHA256SUMS'])
 binding={name:sha((host/name).read_bytes()) for name in ['host-config.json','control-base.json','source-plan.json','context-read.sql','runtime/load-source-runtime.js','runtime/start-monitor-true-a42.js','runtime/review-publication.py','FROZEN_MANIFEST.json']}
 summaries.append({'key':key,'status':'READY_OFFLINE_PARENT_FRESH_DB_REQUIRED','sourceId':spec['sourceId'],'sourceConfigSha256':spec['sourceConfigSha256'],'root':str(host),'prefix':spec['prefix'],'startCodeKey':spec['startCodeKey'],'loader':str(host/'runtime/load-source-runtime.js'),'candidate':spec['candidate'],'build':spec['build'],'route':'TRUE_A','heapMiB':384,'checks':frozen['checks'],'bindingSha256':binding,'gap':None,'notLaunched':True})
recipes=['restore-due-a46.py','prepare-due-a46.mjs','check-due-a46.mjs','check-due-a46-safety.mjs','check-due-a46-launch-guards.mjs','test-due-a46-reviewers.py','finalize-due-a46-identity.mjs','freeze-due-a46.py']
allSafe.extend(R/'verification'/p for p in recipes)
for p in sorted(set(allSafe)):assert p.is_file() and not p.is_symlink()
filelist=R/'verification/DUE_A46_SOURCE_FILELIST.txt';sums=R/'verification/DUE_A46_SOURCE_SHA256SUMS'
write(filelist,'\n'.join(str(p.relative_to(R)) for p in sorted(set(allSafe)))+'\n');write(sums,''.join(sha(p.read_bytes())+'  '+str(p.relative_to(R))+'\n' for p in sorted(set(allSafe))))
package=R/'verification/due-a46-safe-source-20261006T0113Z.tar.gz'
with tarfile.open(package,'w:gz') as t:
 for p in sorted(set(allSafe+[filelist,sums])):t.add(p,arcname=str(p.relative_to(R)),recursive=False)
summary={'schemaVersion':1,'createdAt':now,'status':'FIVE_SOURCES_READY_OFFLINE_PARENT_FRESH_DB_REQUIRED','sourceNetworkAccessed':False,'databaseAccessed':False,'producerLaunched':False,'producerModified':False,'otherActiveHostsModified':False,'unknownSourcesUntouched':True,'candidateVersion':46,'amgen47Untouched':True,'schemaMigrations':48,'reviewerCases':245,'reviewerPositive':10,'reviewerNegative':235,'fullCertificateReceiptPositives':10,'sourcePackage':str(package),'sourcePackageSha256':sha(package.read_bytes()),'sourcePackageBytes':package.stat().st_size,'sourceSafeFileCount':len(set(allSafe)),'sourcePackageExcludes':['host-config.json','control-base.json','source-plan.json','context-read.sql','SPEC.json','PREPARED.json','real-or-synthetic-runs','raw','readbacks','bootstrap','capture'],'sources':summaries}
save(R/'verification/DUE_A46_READY.json',summary)
print(json.dumps({'ready':keys,'reviewerCases':245,'schemaMigrations':48,'sourcePackage':str(package),'sha256':summary['sourcePackageSha256']}))
