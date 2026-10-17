// @vitest-environment node
// Artificial fixture only; no network, production database, or captured real pages.
import {beforeAll,afterAll,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collect,http,dom,AT,LATER} from '../helpers/sanofiHeaderFixture';
import {sanofiHash,bindSanofiChineseIndependentArtifact} from '../../src/crawler/sanofiChineseNative';
import {captureSanofiChineseIndependent,replaySanofiChineseIndependent} from '../../src/crawler/sanofiChineseRenderedTraversal';
import {sourcePlanConfigSha256} from '../../src/crawler/sourcePlan';
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt,SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION,SANOFI_INDEPENDENT_ORIGINAL_LOCATOR} from '../../src/crawler/traversalCertificate';
import {canonicalStringSetSha256} from '../../src/crawler/sourceFetchEvidence';
import {archiveSourceEvidence,verifyArchivedSourceEvidence} from '../../src/crawler/artifactArchive';
import {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds} from '../../src/crawler/runtimeAtomicEvidence';
import {bindSanofiPersistedArtifacts} from '../../src/db/portablePublicSnapshotRepository';
import {deriveDbStartedPublicationExpiry} from '../../src/db/ingestionRepository';
import {hashProjectionJson} from '../../src/domain/jobProjectionDeltaReceipt';
import {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION} from '../../src/crawler/stagedScheduleAuthority';
import {compileDbStartedCloudSourcePublication} from '../../src/db/ingestionRepository';
import {NOVO_JOB_VERIFICATION_MIGRATION_NAME,NOVO_JOB_VERIFICATION_SCHEMA_SHA256} from '../../src/db/novoJobVerificationProfile';
import {V75_FENCE_MIGRATION_NAME,V75_FENCE_SCHEMA_SHA256} from '../../src/db/v75FenceProfile';
let fixture:any;
afterAll(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
beforeAll(async()=>{
 vi.stubEnv("JOBFINDER_CLOUD_SOURCE_ID","source-sanofi-china-social");
 const change=(url:string,body:string)=>url.endsWith('exid=R9000002')?body.replaceAll('中文岗位2','Native role two'):body;
 const {p,result}=await collect(change),client=http(false,change);
 const captured=await captureSanofiChineseIndependent({dom:dom(),http:async r=>({...await client(r),capturedAt:LATER}),now:()=>new Date(LATER)});
 const validation=createOfficialJsonRenderedTraversalValidation({sourceId:'source-sanofi-china-social',companyId:p.company.id,sourceConfigSha256:sourcePlanConfigSha256(p),surfaceIds:[p.source.surfaceId!],channelIds:p.expectedChannels!.map(c=>c.channelId),pages:captured.pages,observedAt:AT,expiresAt:'2026-10-04T17:30:00.000Z'});
 result.fetchEvidence=bindSanofiChineseIndependentArtifact(p,result.fetchEvidence!,validation.artifactSha256);
 const buildBase={schemaVersion:2 as const,commitSha:'a'.repeat(40),sourceTreeSha256:'b'.repeat(64),runtimeTreeSha256:'c'.repeat(64)};
 const build={...buildBase,contentSha256:sanofiHash(JSON.stringify(buildBase))},candidate={id:'synthetic-compact',goalId:'jobfinder-portable-required-40' as const,version:102};
 const expected=deriveCurrentStagedScheduleExpectation(build);
 const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'dot-cloud-sanofi-china-social-pilot',expectedPlannedSourceIds:[p.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:canonicalStringSetSha256([p.source.id])};
 const planned=buildPendingRuntimeBatch('synthetic-compact-batch',[p],identity,new Date(AT)),pending=planned.sources[0]!;
 const tuple={releaseCandidateId:candidate.id,batchId:planned.batch.id,sourceResultId:pending.id,sourceId:p.source.id};
 const binding={...tuple,sourceConfigSha256:sourcePlanConfigSha256(p)};
 const raw=Buffer.from(JSON.stringify(validation)),independentOriginal={sha256:sanofiHash(raw.toString()),byteCount:raw.length,canonicalArtifactSha256:validation.artifactSha256};
 const workspaceRoot=await mkdtemp(join(tmpdir(),'sanofi-compact-artificial-'));
 const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence!.artifacts})});
 const independentArchive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:{name:validation.validatorImplementationId,version:'2'},artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:[{id:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,logicalKey:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR,kind:'COMMAND_OUTPUT',capturedAt:LATER,body:raw,bodyRepresentation:'EXACT',extractorLocator:SANOFI_INDEPENDENT_ORIGINAL_LOCATOR}]})});
 archive.artifacts.push(...independentArchive.artifacts);
 await verifyArchivedSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',artifacts:archive.artifacts});
 expect(await readFile(join(workspaceRoot,independentArchive.artifacts[0]!.path))).toEqual(raw);
 const input={plan:p,binding,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation,validationExecution:'CURRENT_RUN' as const,trigger:'INITIAL_QUALIFICATION' as const,now:new Date(LATER)};
 const issued=issueBGradeTraversalCertificate({...input,sanofiArchive:{artifacts:archive.artifacts,independentOriginal}});
 expect(issued.status).toBe('CERTIFIED');if(issued.status!=='CERTIFIED')throw Error(JSON.stringify(issued));
 fixture={input,issued,p,result,captured,archive,independentOriginal,build,candidate,expected,identity,planned,pending};
});
function reader(){return {certificate:structuredClone(fixture.issued.certificate),certificateSha256:fixture.issued.certificateSha256,now:new Date(LATER),expected:{...fixture.input.binding,canonicalJobSetSha256:fixture.issued.certificate.output.canonicalJobSetSha256,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(replaySanofiChineseIndependent(fixture.captured.pages).rawEvidenceIds),sanofiArtifacts:structuredClone(fixture.archive.artifacts)}};}
describe('Sanofi explicit compact pre-commit dual-original attestation',()=>{
 it('archives exact independent bytes and preserves decisions/title conflict, without HTML pages in receipt',()=>{
  const r=reader(),certificate=r.certificate;
  expect(verifyBGradeTraversalCertificateReceipt(r)).toMatchObject({status:'PASS',finalUniqueJobCount:2});
  expect(certificate.schemaVersion).toBe(SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION);
  expect(certificate.proofBasis).toBe('PRE_COMMIT_DUAL_ORIGINAL_REPLAY');
  expect(certificate.independentValidation.pages).toBeUndefined();
  expect(JSON.stringify(certificate)).not.toContain('searchResultsHtml');
  expect(JSON.parse(certificate.mainTraversal.sanofiIdentityProof.oracleBody).decisions.some((d:any)=>d.titleConflict)).toBe(true);
  expect(deriveDbStartedPublicationExpiry({startedAt:new Date(AT),completenessCertificate:certificate})).toBe(Date.parse(AT)+30*60_000);
  console.log(JSON.stringify({fixture:'ARTIFICIAL_ONLY',certificateByteCount:Buffer.byteLength(JSON.stringify(certificate)),independentRawByteCount:fixture.independentOriginal.byteCount,archiveArtifactCount:fixture.archive.artifacts.length}));
 });
 it('preserves old full-B issuance and verification',()=>{
  const old=issueBGradeTraversalCertificate(fixture.input);expect(old.status).toBe('CERTIFIED');if(old.status!=='CERTIFIED')throw Error('old');
  expect(old.certificate.schemaVersion).toBe('b-grade-independent-traversal-v2');
  expect(verifyBGradeTraversalCertificateReceipt({...reader(),certificate:old.certificate,certificateSha256:old.certificateSha256}).status).toBe('PASS');
 });
 it.each(['hash','tuple','missingArtifact','extraArtifact','archiveHash','archiveTime','independentCanonical','rawSet','expired','oracle','pageCount'])('rejects %s without semantic HTML replay',mode=>{
  const r=reader();
  if(mode==='hash')r.certificateSha256='0'.repeat(64);
  if(mode==='tuple')r.expected.sourceResultId='wrong';
  if(mode==='missingArtifact')r.certificate.artifacts.pop();
  if(mode==='extraArtifact')r.expected.sanofiArtifacts.push({...r.expected.sanofiArtifacts[0],extractorLocator:'uncommitted'});
  if(mode==='archiveHash')r.expected.sanofiArtifacts[0].sha256='0'.repeat(64);
  if(mode==='archiveTime')r.expected.sanofiArtifacts[0].capturedAt=new Date('2026-10-04T16:59:00.000Z');
  if(mode==='independentCanonical')r.certificate.independentValidation.originalFile.canonicalArtifactSha256='0'.repeat(64);
  if(mode==='rawSet')r.expected.canonicalRawEvidenceIdSetSha256='0'.repeat(64);
  if(mode==='expired')r.now=new Date('2026-10-04T17:30:00.000Z');
  if(mode==='oracle'){const o=JSON.parse(r.certificate.mainTraversal.sanofiIdentityProof.oracleBody);o.decisions[0].title='Changed';r.certificate.mainTraversal.sanofiIdentityProof.oracleBody=JSON.stringify(o);}
  if(mode==='pageCount')r.certificate.mainTraversal.pageCount=r.certificate.independentValidation.pageCount=2;
  if(mode!=='hash')r.certificateSha256=hashProjectionJson(r.certificate);
  expect(()=>verifyBGradeTraversalCertificateReceipt(r)).toThrow();
 });
 it('pre-commit issuer still rejects real semantic drift in the artificial original',()=>{
  const input=structuredClone(fixture.input);input.independentValidation.pages[0].rawRows[0].rawPayload.nativeResponse.body+=' altered';
  expect(()=>issueBGradeTraversalCertificate({...input,sanofiArchive:{artifacts:fixture.archive.artifacts,independentOriginal:fixture.independentOriginal}})).toThrow();
 });
 it.each(['schema50','schema51'])('compiles the original atomic delta publication on %s without database execution',async profile=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(LATER));
  const f=fixture,{p,candidate,build,expected:e}=f;
  const databaseIdentity={migrationVersion:profile==='schema51'?NOVO_JOB_VERIFICATION_MIGRATION_NAME:V75_FENCE_MIGRATION_NAME,schemaHash:profile==='schema51'?NOVO_JOB_VERIFICATION_SCHEMA_SHA256:V75_FENCE_SCHEMA_SHA256,dbSnapshotHash:'d'.repeat(64)};
  const candidateRow={...candidate,commitSha:e.commitSha,...databaseIdentity,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount,status:'BUILDING'};
  const context={checkedAt:LATER,sourceId:p.source.id,sourceConfigSha256:f.input.binding.sourceConfigSha256,jobs:[],latestAccepted:null,firstAccepted:null,candidateRow,sourceRow:{id:p.source.id,companyId:p.company.id,kind:p.source.kind,atsKind:p.source.atsKind,status:p.source.status,officialEntryUrl:p.source.officialEntryUrl,officialChainEvidenceUrl:p.source.officialChainEvidenceUrl},companyRow:{id:p.company.id,officialChineseName:p.company.officialChineseName}};
  const packet=await compileDbStartedCloudSourcePublication({jobProjectionDelta:true,control:{projectId:'yiopvxysxrtrnvqxwgbx',build,candidate,databaseIdentity,planned:f.planned,context},source:{plan:p,pending:f.pending,identity:f.identity,batchId:f.planned.batch.id,result:f.result,artifacts:f.archive.artifacts,sanofiIndependentOriginal:f.independentOriginal,completedAt:new Date(LATER),publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',independentTraversalValidation:f.input.independentValidation,independentTraversalValidationExecution:'CURRENT_RUN',independentTraversalValidationTrigger:'INITIAL_QUALIFICATION'}});
  expect(packet.commit.sourceResult.completenessCertificate).toMatchObject({schemaVersion:'job-projection-delta-receipt-v1',legacyCertificate:{schemaVersion:SANOFI_COMPACT_CERTIFICATE_SCHEMA_VERSION}});
  expect(packet.sql.match(/DO \$atomic_/g)).toHaveLength(1);
  expect(packet.sql).not.toContain('searchResultsHtml');
  expect(packet.sql).toContain('formal-crawl');
  expect(packet.expiresAt).toBe('2026-10-04T17:30:00.000Z');
  const {loadPilotContext}=await import('../../src/crawler/cloudPilotContext');
  const observationCommand=packet.commit.commands.find(c=>c.type==='UPSERT_CRAWL_OBSERVATION');
  if(observationCommand?.type!=='UPSERT_CRAWL_OBSERVATION')throw Error('Expected artificial observation');
  const accepted=JSON.parse(JSON.stringify({...packet.commit.sourceResult,observations:[{...observationCommand.observation,...packet.commit.observationProvenance}],evidenceArtifacts:f.archive.artifacts.map((a:any)=>({releaseCandidateId:a.releaseCandidateId,batchId:a.batchId,sourceResultId:a.sourceResultId,sourceId:a.sourceId,kind:a.kind,sha256:a.sha256,extractorLocator:a.extractorLocator,byteCount:a.byteCount,capturedAt:a.capturedAt}))}));
  expect((await loadPilotContext({...context,firstAccepted:accepted,latestAccepted:accepted},p,true)).trustedCompletenessBaseline?.sourceResultId).toBe(f.pending.id);
  console.log(JSON.stringify({fixture:'ARTIFICIAL_ONLY',profile,sqlByteCount:Buffer.byteLength(packet.sql),deltaByteCount:Buffer.byteLength(JSON.stringify(packet.commit.sourceResult.completenessCertificate))}));
  if(profile==='schema51')await writeFile('../synthetic-atomic-packet.json',JSON.stringify({classification:'ARTIFICIAL_ONLY_NO_DB_WRITE',packet,plan:p,artifactMetadata:f.archive.artifacts}));
  vi.useRealTimers();
 });
 it('queries all persisted artifacts for compact, so omitted ordinary main artifacts cannot choose their own DB subset',async()=>{
  const r=reader(),row={...r.expected,id:r.expected.sourceResultId,atomicCommitState:'COMMITTED',completenessState:'VERIFIED',completenessCertificate:r.certificate,completenessCertificateSha256:r.certificateSha256};
  const findMany=vi.fn(async()=>r.expected.sanofiArtifacts);await bindSanofiPersistedArtifacts({evidenceArtifact:{findMany}} as any,[row as any]);
  const where=(findMany.mock.calls as any)[0][0].where.OR[0];expect(where).not.toHaveProperty('extractorLocator');
  expect(where).toMatchObject({sourceId:'source-sanofi-china-social',sourceResultId:r.expected.sourceResultId});
 });
});
