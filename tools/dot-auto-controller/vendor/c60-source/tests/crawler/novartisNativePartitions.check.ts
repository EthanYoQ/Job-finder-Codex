import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serialize} from 'node:v8';
import {candidateCompanies} from '../../src/data/companyRegistry';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../../src/crawler/sourcePlan';
import {acquireNovartisNativePartitions,replayNovartisNativePartitions} from '../../src/crawler/novartisNativePartitions';
import {runSourceCrawl} from '../../src/crawler/runSourceCrawl';
import {createReviewedRetainedSourceFetch,issueSourceQualityAdmission} from '../../src/crawler/sourceQualityAdmission';
import {archiveSourceEvidence} from '../../src/crawler/artifactArchive';
import {bindRuntimeEvidenceArtifactIds,buildPendingRuntimeBatch,buildAtomicRuntimeCommit,verifyAtomicRuntimeCommitForPersistence} from '../../src/crawler/runtimeAtomicEvidence';
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-novartis-social')!;
const fields=['FN','BS','CM','CA','DD','FA','HR','IT','NN','LI','MA','MM','OT','PR','QA','RD','SA','TO','EE','ZZ'].map(x=>'FCT_'+x);
const url=(id:string)=>`https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-test`;
const row=(id:string)=>`<tr><td class="views-field-field-job-title"><a href="${url(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`;
const page=(ids:string[],n=ids.length)=>`<div class="view-header">Showing ${n} results</div><table class="views-table"><tbody>${ids.length?ids.map(row).join(''):'<tr><td colspan="5" class="empty message">No content has been found.</td></tr>'}</tbody></table>`;
const root=page([],2)+`<select name="functional_area[]">${fields.map(v=>`<option value="${v}">${v}</option>`).join('')}</select><select name="country[]"><option value="LOC_CN" selected>China</option></select><select name="field_job_posted_date"><option value="All" selected>All</option></select>`;
const ids=['REQ-10000001','REQ-10000002','REQ-10000003'];
async function capture(mode='present'){
 const at=new Date().toISOString();const requests:string[]=[];
 const fetched=await acquireNovartisNativePartitions(plan,async req=>{requests.push(req.url);const u=new URL(req.url),field=u.searchParams.get('functional_area[0]');
 let html=req.url===plan.source.officialEntryUrl?root:field?page(field==='FCT_QA'?[ids[0]!]:field==='FCT_SA'?[ids[1]!]:[]):page(ids);
 if(u.pathname.includes('/job/details/'))html=`<h1>Job ${ids[2]}</h1><article>Job ID ${ids[2]}<p>${mode==='closed'?'This job is no longer available':'A real substantive job description for this identity.'}</p>${mode==='present'?`<a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${ids[2]}">Apply to Job</a>`:''}</article>`;
 return {status:200,body:html,finalUrl:req.url,contentType:'text/html',capturedAt:at};});return {fetched,at,requests};
}
const c=await capture();if(!c.fetched.ok)console.log(c.fetched.failureReason,c.fetched.fetchEvidence?.artifacts.map(a=>a.logicalKey));assert(c.fetched.ok);assert.equal(c.fetched.fetchEvidence!.fetchCounts.validCount,3);
const e=c.fetched.fetchEvidence!;const audit=replayNovartisNativePartitions(plan,e).audit;assert.equal(audit.indexDeclaredTotal,2);assert.equal(audit.observedUniqueCount,3);assert(!c.requests.some(u=>u.includes('moseeker')));console.log('PASS distinct base/current counts and exact positive presence');
for(const [name,mutate] of [
 ['missing partition',(x:any)=>{x.artifacts=x.artifacts.filter((a:any)=>a.logicalKey!=='novartis-partition-FCT_DD-0')}],
 ['fake index total',(x:any)=>{x.artifacts[0].body=x.artifacts[0].body.replace('Showing 2','Showing 3')}],
 ['scope changed',(x:any)=>{x.artifacts.find((a:any)=>a.logicalKey==='novartis-partition-FCT_QA-0').finalUrl='https://www.novartis.com.cn/careers/career-search'}],
 ['apply identity changed',(x:any)=>{const a=x.artifacts.find((a:any)=>a.logicalKey.includes('detail-'));a.body=a.body.replace('job_number=REQ-10000003','job_number=REQ-10000099')}],
 ['ledger forged',(x:any)=>{x.fetchCounts.validCount=2}]
] as const){const x=structuredClone(e);mutate(x);assert.throws(()=>replayNovartisNativePartitions(plan,x));console.log('PASS rejects',name);}
const unknownCapture=await capture('unknown');assert(unknownCapture.fetched.ok);assert.equal(replayNovartisNativePartitions(plan,unknownCapture.fetched.fetchEvidence!).audit.noOmissionVerified,false);const closed=await capture('closed');assert(closed.fetched.ok);assert.equal(closed.fetched.fetchEvidence!.fetchCounts.validCount,2);console.log('PASS unknown audited exclusion and explicit closed exclusion');
const workspace=await mkdtemp(join(tmpdir(),'novartis-partition-issuer-'));const digest=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const bytes=serialize(c.fetched),path=join(workspace,'original.v8');await writeFile(path,bytes);
const manifest=JSON.stringify({schemaVersion:2,sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt:c.at,finishedAt:c.at,fetched:{path,sha256:digest(bytes),encoding:'v8'}});const manifestPath=join(workspace,'retained.json');await writeFile(manifestPath,manifest);
const fetch=await createReviewedRetainedSourceFetch(manifestPath,digest(manifest));const result=await runSourceCrawl(plan,{fetch,isBaseline:false});console.log('truth',result.truth);assert.equal(result.truth.completenessVerified,true);
const identity={releaseCandidateId:'novartis-partition-test',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:digest(JSON.stringify([plan.source.id])),expectedPlannedSourceCount:1};
const batchId='novartis-partition-'+Date.now(),pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(c.at)).sources[0]!;const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};const evidenceSubdirectory='quality/evidence';
const archive=await archiveSourceEvidence({workspaceRoot:workspace,evidenceSubdirectory,...binding,sourceId:plan.source.id,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
const input={plan,result,binding,identity,batchId,pending,archive:{workspaceRoot:workspace,evidenceSubdirectory,artifacts:archive.artifacts}};const admission=await issueSourceQualityAdmission(input);console.log('admission',admission.status);assert.equal(admission.status,'ACCEPTED');
const commit=buildAtomicRuntimeCommit({...input,artifacts:archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});await verifyAtomicRuntimeCommitForPersistence(commit);assert.equal(commit.commands.filter(c=>c.type==='UPSERT_JOB').length,3);console.log('PASS original issuer and atomic persistence verifier (offline fixtures, no database)',workspace);

// A later UNKNOWN keeps only the exact old identity; never renew its observation.
const {buildJobDedupeKey}=await import('../../src/crawler/normalizedJob');
const {compilePortableAtomicSourceEvidenceSql}=await import('../../src/db/ingestionRepository');
const {acquirePortableCrawlLease}=await import('../../src/crawler/portableCrawlLease');
const u=await capture('unknown');assert(u.fetched.ok);
const udir=await mkdtemp(join(tmpdir(),'novartis-unknown-'));const ubytes=serialize(u.fetched),upath=join(udir,'original.v8');await writeFile(upath,ubytes);
const um=JSON.stringify({schemaVersion:2,sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt:u.at,finishedAt:u.at,fetched:{path:upath,sha256:digest(ubytes),encoding:'v8'}});const ump=join(udir,'retained.json');await writeFile(ump,um);
const ur=await runSourceCrawl(plan,{fetch:await createReviewedRetainedSourceFetch(ump,digest(um)),isBaseline:false});assert(ur.truth.completenessVerified);
const ubid='unknown-'+Date.now(),upending=buildPendingRuntimeBatch(ubid,[plan],identity,new Date(u.at)).sources[0]!;
const ubinding={...binding,batchId:ubid,sourceResultId:upending.id};
const ua=await archiveSourceEvidence({workspaceRoot:udir,evidenceSubdirectory,...ubinding,sourceId:plan.source.id,captureTool:ur.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...ubinding,sourceId:plan.source.id,artifacts:ur.fetchEvidence!.artifacts})});
const ui={plan,result:ur,binding:ubinding,identity,batchId:ubid,pending:upending,archive:{workspaceRoot:udir,evidenceSubdirectory,artifacts:ua.artifacts}};
const uq=await issueSourceQualityAdmission(ui);assert.equal(uq.status,'ACCEPTED');assert(admission.status==='ACCEPTED');
const olds=result.jobs.map(record=>({dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:'ACTIVE' as const,missingSuccessfulCrawlCount:0,firstSeenAt:admission.receipt.issuedAt,lastSeenAt:admission.receipt.issuedAt}));
const prior={receipt:admission.receipt,receiptSha256:admission.receiptSha256,expectedBinding:admission.receipt.binding};
for(const state of ['ACTIVE','OFFLINE'] as const){
 const previousJobs=olds.map(p=>p.record.officialUrl===url(ids[2]!)?{...p,lifecycleStatus:state,missingSuccessfulCrawlCount:state==='OFFLINE'?3:0}:p);
 const held=buildAtomicRuntimeCommit({...ui,artifacts:ua.artifacts,previousJobs,baselineCompletedBeforeCrawl:true,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',sourceQualityAdmission:uq,firstAcceptedCurrentPolicyReceipt:prior});
 await verifyAtomicRuntimeCommitForPersistence(held);
 const command=held.commands.find(c=>c.type==='UPSERT_JOB'&&c.record.officialUrl===url(ids[2]!));assert(command&&command.type==='UPSERT_JOB');assert.equal(command.lifecycleStatus,state);assert.equal(command.lastSeenAt,olds[0]!.lastSeenAt);assert.equal(command.missingSuccessfulCrawlCount,state==='ACTIVE'?1:3);
 const lease=await acquirePortableCrawlLease({$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})});
 const sql=await compilePortableAtomicSourceEvidenceSql(held,lease);assert(sql.includes('Job'));
 if(state==='ACTIVE'){
   const {buildJobProjectionDeltaReceipt}=await import('../../src/db/jobProjectionDeltaCompiler');
   const projectionForCommand=(c:any)=>({companyId:c.record.companyId,sourceId:c.record.sourceId,dedupeKey:c.dedupeKey,sourceJobId:c.record.sourceJobId??null,officialTitle:c.record.officialTitle,officialUrl:c.record.officialUrl,listUrl:c.record.listUrl??null,locationRaw:c.record.locationRaw,city:c.record.cities[0],cities:c.record.cities,officialPublishedAt:c.record.officialPublishedAt??null,missingSuccessCount:c.missingSuccessfulCrawlCount,lifecycleStatus:c.lifecycleStatus,visibleInFrontend:c.visibleInFrontend,isNew:c.isNew});
   const first=buildJobProjectionDeltaReceipt({sourceResult:commit.sourceResult,commands:commit.commands,previousAccepted:null,projectionForCommand});
   const firstRow={...commit.sourceResult,completenessCertificate:first.receipt,completenessCertificateSha256:first.sha256};
   const second=buildJobProjectionDeltaReceipt({sourceResult:held.sourceResult,commands:held.commands,previousAccepted:firstRow,projectionForCommand});
   const thirdAt=new Date(Date.parse(second.receipt.verifiedAt)+1000).toISOString();
   const thirdSource={...held.sourceResult,id:held.sourceResult.id+'-third',finishedAt:new Date(thirdAt)};
   const thirdCommands=held.commands.map(c=>c.type==='UPSERT_JOB'&&c.missingSuccessfulCrawlCount===0?{...c,lastSeenAt:thirdAt}:c);
   const secondRow={...held.sourceResult,completenessCertificate:second.receipt,completenessCertificateSha256:second.sha256};
   const third=buildJobProjectionDeltaReceipt({sourceResult:thirdSource,commands:thirdCommands,previousAccepted:secondRow,projectionForCommand});
   const member=third.receipt.members.find(m=>m.setKind==='GRACE')!;assert(member);assert.equal(member.lastPresentResultId,commit.sourceResult.id);assert.equal(member.lifecycleLastSeenAt,admission.receipt.issuedAt);assert.equal(member.lastConfirmedObservedAt,first.receipt.observedAt);
   console.log('PASS repeated UNKNOWN GRACE retains original true CURRENT anchor and both old timestamps');
 }
 console.log('PASS original SQL preparation, UNKNOWN prior',state,'preserves old fields/time and does not revive');
}
