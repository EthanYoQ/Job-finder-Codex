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
assert.equal((await capture('unknown')).fetched.ok,false);const closed=await capture('closed');assert(closed.fetched.ok);assert.equal(closed.fetched.fetchEvidence!.fetchCounts.validCount,2);console.log('PASS unknown HOLD and explicit closed exclusion');
const workspace=await mkdtemp(join(tmpdir(),'novartis-partition-issuer-'));const digest=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const bytes=serialize(c.fetched),path=join(workspace,'original.v8');await writeFile(path,bytes);
const manifest=JSON.stringify({schemaVersion:2,sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),startedAt:c.at,finishedAt:c.at,fetched:{path,sha256:digest(bytes),encoding:'v8'}});const manifestPath=join(workspace,'retained.json');await writeFile(manifestPath,manifest);
const fetch=await createReviewedRetainedSourceFetch(manifestPath,digest(manifest));const result=await runSourceCrawl(plan,{fetch,isBaseline:false});console.log('truth',result.truth);assert.equal(result.truth.completenessVerified,true);
const identity={releaseCandidateId:'novartis-partition-test',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:digest(JSON.stringify([plan.source.id])),expectedPlannedSourceCount:1};
const batchId='novartis-partition-'+Date.now(),pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(c.at)).sources[0]!;const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};const evidenceSubdirectory='quality/evidence';
const archive=await archiveSourceEvidence({workspaceRoot:workspace,evidenceSubdirectory,...binding,sourceId:plan.source.id,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
const input={plan,result,binding,identity,batchId,pending,archive:{workspaceRoot:workspace,evidenceSubdirectory,artifacts:archive.artifacts}};const admission=await issueSourceQualityAdmission(input);console.log('admission',admission.status);assert.equal(admission.status,'ACCEPTED');
const commit=buildAtomicRuntimeCommit({...input,artifacts:archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});await verifyAtomicRuntimeCommitForPersistence(commit);assert.equal(commit.commands.filter(c=>c.type==='UPSERT_JOB').length,3);console.log('PASS original issuer and atomic persistence verifier (offline fixtures, no database)',workspace);
