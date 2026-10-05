"""Local review only. Counts and time are derived from this packet, never a historic target."""
import json,re,hashlib,datetime,sys,subprocess,os
from pathlib import Path
host,run=Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve();rid=sys.argv[3]
assert run.parent==host and str(host)=='/workspace/scratch/5e9614251709/jb-workspace-recovery-20261005T2019Z/hosts46/servier' and re.fullmatch(r'[a-f0-9-]{36}',rid)
cfg=json.loads((host/'host-config.json').read_text());assert cfg['sourceId']=='source-servier-china-social'
env={**os.environ,'TSX_DISABLE_CACHE':'1','NODE_DISABLE_COMPILE_CACHE':'1','PYTHONDONTWRITEBYTECODE':'1','JOBFINDER_CLOUD_SOURCE_ID':cfg['sourceId']}
subprocess.run(['node',str(host/'runtime/publisher-state-guard.mjs'),'publish',run.name],check=True,capture_output=True,env=env)
req=json.loads((run/'relay'/f'{rid}.request.json').read_text());sql=(run/'relay'/f'{rid}.request.json.sql').read_text()
assert req['kind']=='PUBLISH' and req['payload']['projectId']==cfg['project']=='yiopvxysxrtrnvqxwgbx' and req['payload']['sql']==sql
assert not (run/'relay'/f'{rid}.dispatch.json').exists()
assert re.fullmatch(r"SET LOCAL statement_timeout = '120000ms';\nDO (\$atomic_[a-f0-9]{32}\$)\n[\s\S]+\n\1;",sql)
scope={'sql':sql};exec((host/'runtime/compact-json-review.inc.py').read_text(),scope)
row=scope['env']['source_result_data'];cert=row['completenessCertificate']
assert row['id']==run.name+'--'+cfg['sourceId'] and row['batchId']==run.name and row['sourceId']==cfg['sourceId']
assert row['releaseCandidateId']=='dot-cloud-restored-fb0b8e3-20261005T2028Z' and row['sourceConfigHash']==cfg['sourceConfigSha256']
assert [row[k] for k in ['transportState','adapterState','completenessState','atomicCommitState']]==['SUCCEEDED','SUCCEEDED','VERIFIED','COMMITTED']
assert cert['schemaVersion']=='b-grade-independent-traversal-v2' and cert['grade']=='B' and cert['validationPolicy']['execution']=='CURRENT_RUN'
for a,b in [('sourceId','sourceId'),('sourceResultId','id'),('batchId','batchId'),('releaseCandidateId','releaseCandidateId'),('sourceConfigSha256','sourceConfigHash')]:assert cert['binding'][a]==row[b]
iv=json.loads((run/'artifacts'/f'{run.name}.independent-validation.json').read_text());assert cert['independentValidation']==iv
assert iv['sourceId']==cfg['sourceId'] and iv['companyId']=='company-servier-china' and iv['sourceConfigSha256']==cfg['sourceConfigSha256']
assert iv['canonicalMatchKeySetSha256']==cert['mainTraversal']['canonicalMatchKeySetSha256']
raw=[r for page in iv['pages'] for r in page['rawRows']]
included=[r['sourceJobId'] for r in raw if r['scopeDecision']=='INCLUDED_MAINLAND'];excluded=[r['sourceJobId'] for r in raw if r['scopeDecision']=='EXCLUDED_AUDITED']
assert len(raw)==len(set(r['sourceJobId'] for r in raw))==row['rawCount']==row['parsedCount']
assert len(included)+len(excluded)==len(raw) and len(included)==row['validCount']==row['dedupeOutputCount']
assert len(excluded)==row['validationDiscardCount'] and all(r['scopeMarker']=='UNKNOWN_GEOGRAPHY' for r in raw if r['scopeDecision']=='EXCLUDED_AUDITED')
# Read both exact frozen sqlRecords encodings: one full object or common fields
# plus indexed tuples for multiple rows. Semicolons inside loss reasons are data.
def recordsets(table):
    result=[]
    for match in re.finditer(r'FROM jsonb_populate_recordset\(NULL::public\."'+table+r'",\s*',sql):
        p=scope['Parser'](sql,match.end())
        if not p.take('(SELECT jsonb_agg('):
            parsed=p.expr();assert isinstance(parsed,list);result.extend(parsed);continue
        common=p.atom();assert isinstance(common,dict) and p.take('||') and p.take('jsonb_build_object(')
        fields=[]
        if not p.take(')'):
            while True:
                name=p.string();assert p.take(',') and p.take('tuple.value->');p.ws()
                number=re.match(r'\d+',sql[p.i:]);assert number;p.i+=len(number[0]);fields.append((name,int(number[0])))
                if p.take(')'):break
                assert p.take(',')
        assert p.take('ORDER BY tuple.ordinality)') and p.take('FROM jsonb_array_elements(')
        tuples=p.expr();assert isinstance(tuples,list)
        for values in tuples:
            assert isinstance(values,list);result.append({**common,**{key:values[index] for key,index in fields}})
    return result
losses=recordsets('LossLedgerEntry')
assert len(losses)==len(excluded)
for loss in losses:
    for key in ['releaseCandidateId','batchId','sourceId']:assert loss[key]==row[key]
    assert loss['sourceResultId']==row['id'] and loss['stage']=='VALIDATION'
    assert loss['reason']=='Servier official detail leaves workplace country unknown; posting remains open'
    assert loss['details']['code']=='SERVIER_WORKPLACE_COUNTRY_UNKNOWN' and loss['details']['field']=='locations' and loss['details']['noteCode']=='OFFICIAL_STATUS_OPEN_GEOGRAPHY_PENDING'
def sethash(values):return hashlib.sha256(json.dumps(sorted(set(values),key=lambda s:s.encode()),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
members=recordsets('LifecycleSetEvidenceMember');current=[m for m in members if m['setKind']=='CURRENT']
assert len(current)==len({m['jobKey'] for m in current})==row['dedupeOutputCount']
for member in members:
    for key in ['releaseCandidateId','batchId','sourceId']:assert member[key]==row[key]
    assert member['sourceResultId']==row['id']
assert sethash([m['jobKey'] for m in current])==row['canonicalCurrentJobSetSha256']
assert sethash([r['sourceJobId'] for r in raw])==cert['mainTraversal']['canonicalRawMatchKeySetSha256']
assert sethash(included)==cert['mainTraversal']['canonicalMatchKeySetSha256'] and sethash(excluded)==cert['mainTraversal']['canonicalExcludedMatchKeySetSha256']
assert cert['counts']['mainUniqueJobCount']==cert['counts']['independentUniqueJobCount']==cert['counts']['finalUniqueJobCount']==len(included)
assert row['parseDiscardCount']==row['normalizationDiscardCount']==row['dedupeDiscardCount']==0
assert cert['output']['canonicalJobSetSha256']==row['canonicalCurrentJobSetSha256']==row['canonicalOutputSetSha256']
assert row['expectedJobCount'] is None and row['expectedEvidenceKind']=='COMPLETE_PAGE_TRAVERSAL'
assert not re.search(r'^\s*(?:CREATE|ALTER|DROP|TRUNCATE|DELETE)\s',sql,re.M)
tables=sorted(set(re.findall(r'(?:INSERT INTO|UPDATE) public\."([A-Za-z]+)"',sql)))
assert set(tables)<=set(['CrawlCoordinatorLock','RecruitmentSource','OfficialCareerEntry','OfficialCareerSurface','CrawlBatch','CrawlBatchSourceResult','CrawlObservation','EvidenceArtifact','PaginationEvidence','LossLedgerEntry','LifecycleSetEvidenceMember','TransportAttemptEvidence','Job'])
assert all(x in sql for x in ['PILOT_COMMITTED_EXACT_SOURCE_REQUIRED','PILOT_CURRENT_MEMBERS_DRIFT','SET CONSTRAINTS ALL IMMEDIATE','portable-quality-sync-v1:released','PILOT_MIGRATION_HISTORY','PILOT_SQL45_GUARD_DRIFT'])
boot=json.loads((run/'bootstrap.json').read_text());due=json.loads((run/'source-due-readback.json').read_text())
capture=boot['currentCapture'];validation=boot['independentValidation']
inputs=json.loads(subprocess.check_output(['node','--import',str(Path(cfg['repo'])/'node_modules/tsx/dist/loader.mjs'),str(host/'runtime/validate-capture-inputs.mjs'),capture['path'],capture['sha256'],validation['path'],validation['sha256'],due['nextEligibleAt']],cwd=cfg['repo'],env=env))
assert row['startedAt']==inputs['mainStartedAt'] and iv['observedAt']==inputs['independentObservedAt']
row_path=run/'reviewed-source-result.private.json'
with row_path.open('x') as f:json.dump(row,f,ensure_ascii=False,separators=(',',':'));f.write('\n')
verified=json.loads(subprocess.check_output(['node','--import',str(Path(cfg['repo'])/'node_modules/tsx/dist/loader.mjs'),str(host/'runtime/verify-certificate.mjs'),str(row_path)],cwd=cfg['repo'],env=env))
assert verified['publicationExpiresAt']==inputs['publicationExpiresAt']==req['expiresAt']
now=datetime.datetime.now(datetime.timezone.utc);assert now<datetime.datetime.fromisoformat(req['payload']['dispatchBefore'].replace('Z','+00:00'))
a=run/'artifacts'/f'{run.name}.archive.json';assert a.is_file()
report={'reviewedAt':now.isoformat(),'requestId':rid,'requestSha256':req['requestSha256'],'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'sqlBytes':len(sql.encode()),'sourceResult':{k:row[k] for k in ['id','releaseCandidateId','sourceId','sourceConfigHash','startedAt','finishedAt','rawCount','validCount','validationDiscardCount','dedupeOutputCount','canonicalCurrentJobSetSha256','completenessCertificateSha256']},'rawCount':len(raw),'includedMainlandCount':len(included),'unknownGeographyExcludedCount':len(excluded),'persistedUnknownGeographyLossCount':len(losses),'persistedCurrentMemberCount':len(current),'includedSetSha256':sethash(included),'excludedSetSha256':sethash(excluded),'frozenCertificateVerification':verified,'inputTimeCheck':inputs,'tables':tables,'archiveSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'archiveBytes':a.stat().st_size,'noDdlOrDelete':True,'atomicFinalizationAndRelease':True,'countsAreCurrentEvidenceNotHistoricTargets':True}
with (run/'publication-review.json').open('x') as f:json.dump(report,f,indent=2);f.write('\n')
print(json.dumps(report))
