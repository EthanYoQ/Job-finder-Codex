import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateLedgerOriginal} from './ledger-contract.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createExistingCompiler,HISTORICAL_C60_BUILD,REVIEWED_C60_LOCK_SHA} from './existing-compiler.mjs';
import {verifyRuntimeBeforeImport} from './runtime-integrity.mjs';
const root=process.env.REVIEW_RUNTIME_ROOT;if(!root)throw Error('REVIEW_RUNTIME_ROOT required');
verifyRuntimeBeforeImport(root,HISTORICAL_C60_BUILD,REVIEWED_C60_LOCK_SHA);
const {register}=await import(pathToFileURL(join(root,'node_modules/tsx/dist/esm/api/index.mjs')).href);
register({tsconfig:join(root,'tsconfig.json')});
const moduleAt=name=>import(pathToFileURL(join(root,name)).href);
const {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION}=await moduleAt('src/crawler/stagedScheduleAuthority.ts');
const {buildPendingRuntimeBatch,bindRuntimeEvidenceArtifactIds}=await moduleAt('src/crawler/runtimeAtomicEvidence.ts');
const {hashCanonicalStringSet}=await moduleAt('src/crawler/runtimeBatchIdentity.ts');
const {sourcePlanConfigSha256}=await moduleAt('src/crawler/sourcePlan.ts');
const {runSourceCrawl,createSourceFetchAttemptTracker}=await moduleAt('src/crawler/runSourceCrawl.ts');
const {archiveSourceEvidence}=await moduleAt('src/crawler/artifactArchive.ts');
const {SOURCE_QUALITY_POLICY_ID,createOwnedSourceQualityFetch,issueSourceQualityAdmission,assertIssuedSourceQualityAdmission}=await moduleAt('src/crawler/sourceQualityAdmission.ts');
const {CLOUD_PILOT_SQL45:history}=await moduleAt('src/db/cloudPilotSql45Manifest.ts');
const build=HISTORICAL_C60_BUILD,candidate={id:'review-only-owned-admission',goalId:'jobfinder-portable-required-40',version:60};
const expected=deriveCurrentStagedScheduleExpectation(build),plan=expected.plans.find(p=>p.source.id==='source-hansoh-social');assert.ok(plan);
const sourceConfigSha256=sourcePlanConfigSha256(plan),compiler=await createExistingCompiler({runtimeRoot:root,expectedBuild:HISTORICAL_C60_BUILD,expectedSourceId:plan.source.id,expectedSourceConfigSha256:sourceConfigSha256});
const identity={releaseCandidateId:candidate.id,commitSha:expected.commitSha,rosterSha256:expected.rosterSha256,sourcePlanSha256:expected.sourcePlanSha256,sourceConfigSha256:expected.sourceConfigSha256,adapterBundleSha256:expected.adapterBundleSha256,batchKind:'SCHEDULED',ownerId:'dot-cloud-hansoh-social-pilot',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceCount:1,expectedPlannedSourceSetSha256:hashCanonicalStringSet([plan.source.id])};
const startedAt=new Date(),batchId='review-only-owned-admission',planned=buildPendingRuntimeBatch(batchId,[plan],identity,startedAt),pending=planned.sources[0];
const tuple={releaseCandidateId:candidate.id,batchId,sourceId:plan.source.id,sourceResultId:pending.id};
const oldFetch=globalThis.fetch,workspaceRoot=await mkdtemp(join(tmpdir(),'owned-admission-review-'));let fetchCalls=0;
globalThis.fetch=async(url,init)=>{fetchCalls++;const page=JSON.parse(String(init.body)).PageIndex;return {status:200,url:String(url),headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify({Code:200,Count:1,Data:page?[]:[{Id:'00000000-0000-4000-8000-000000000001',JobAdId:1,JobAdName:'职位1',LocNames:['上海市'],Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,PostDate:'2026-09-20T12:00:00',ChangeDate:'0001-01-01T00:00:00'}]})};};
try{
 const attemptTracker=createSourceFetchAttemptTracker(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false,attemptTracker});
 assert.ok(fetchCalls>0);assert.ok(result.fetchEvidence);
 const archive=await archiveSourceEvidence({workspaceRoot,...tuple,evidenceSubdirectory:'evidence',captureTool:result.fetchEvidence.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...tuple,artifacts:result.fetchEvidence.artifacts})});
 const admission=await issueSourceQualityAdmission({plan,result,binding:{...tuple,sourceConfigSha256,adapterVersion:pending.adapterVersion},archive:{workspaceRoot,evidenceSubdirectory:'evidence',artifacts:archive.artifacts}});
 assert.equal(admission.status,'ACCEPTED');assertIssuedSourceQualityAdmission(admission,result,plan);
 const candidateRow={...candidate,commitSha:expected.commitSha,...history.databaseIdentity,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:expected.sourceTreeSha256,runtimeTreeHash:expected.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:expected.minimumStableCompanyCount,status:'BUILDING'};
 const sourceRow={id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl};
 const context={checkedAt:new Date().toISOString(),sourceId:plan.source.id,sourceConfigSha256,jobs:[],latestAccepted:null,firstAccepted:null,candidateRow,sourceRow,companyRow:{id:plan.company.id,officialChineseName:plan.company.officialChineseName}};
 const now=Date.now(),publicationDeadline=now+400000,binding={projectId:'yiopvxysxrtrnvqxwgbx',sourceId:plan.source.id,sourceConfigSha256,candidateId:candidate.id,batchId,sourceResultId:pending.id,overallDeadline:now+500000,expiresAt:publicationDeadline,dispatchBefore:publicationDeadline-165000};
 const publishInput={source:{plan,pending,identity,batchId,result,artifacts:archive.artifacts,attemptTracker,publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceAdmissionPolicy:SOURCE_QUALITY_POLICY_ID,sourceQualityAdmission:admission},control:{projectId:binding.projectId,build,candidate,planned,context},publicationDeadline};
 const checkedControl=publishInput.control,changedControl={...checkedControl,planned:{...planned,batch:{...planned.batch,ownerId:'review-only-concurrent-mutation'}}};
 let controlReads=0;
 // Deterministic concurrent-input regression: a late reread must not replace
 // the validated/compiler control snapshot used for durable expectations.
 Object.defineProperty(publishInput,'control',{enumerable:true,get(){return ++controlReads>5?changedControl:checkedControl;}});
 const packet=await compiler('PUBLISH',publishInput,binding);
 assert.equal(packet.atomic,true);assert.ok(packet.sql.startsWith('SET LOCAL statement_timeout'));assert.equal(packet.packet.commit.sourceResult.id,pending.id);
 assert.deepEqual(packet.packet.expectedBatch,planned.batch,'The ledger expected batch must be the same immutable snapshot used by the compiler.');
 assert.equal(controlReads,1,'Only one caller control snapshot may be read before compilation.');
 const wire=JSON.parse(JSON.stringify({schemaVersion:1,...binding,requestId:'11111111-1111-4111-8111-111111111111',requestSha256:'1'.repeat(64),sqlSha256:createHash('sha256').update(packet.sql).digest('hex'),holderId:packet.packet.holderId,expectedSourceResult:packet.packet.commit.sourceResult,expectedBatch:packet.packet.expectedBatch}));
 assert.equal(validateLedgerOriginal(wire),true,'A real compiled packet must satisfy the offline ledger wire contract.');

 console.log('PASS: existing producer owned HTTP fixture + archive + live source admission compiled through the portable factory into the original atomic SQL, with stable control snapshot and ledger wire validation, without database/network execution.');
}finally{globalThis.fetch=oldFetch;await rm(workspaceRoot,{recursive:true,force:true});}
