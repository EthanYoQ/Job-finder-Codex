import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {fetchPfizerWorkdayTraversal,PFIZER_API,PFIZER_ENTRY,PFIZER_CHINA,replayPfizerWorkdayTraversal} from '../src/crawler/pfizerWorkdayTraversal.ts';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {irreversibleOfficialJsonEvidenceId} from '../src/crawler/officialJsonEvidence.ts';
import {canonicalStringSetSha256} from '../src/crawler/sourceFetchEvidence.ts';
import {pfizerSourceJobId} from '../src/crawler/pfizerWorkdayTraversal.ts';
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt} from '../src/crawler/traversalCertificate.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
const at='2026-11-06T04:00:00.000Z',path=id=>`/job/Shanghai/Role_${id}`,row=id=>({title:`List ${id}`,bulletFields:[id],externalPath:path(id)});
const detail=id=>JSON.stringify({jobPostingInfo:{jobReqId:id,title:`Official role ${id}`,jobPostingSiteId:'PfizerCareers',externalUrl:PFIZER_ENTRY+path(id),posted:true,canApply:true,jobDescription:'<p>Research laboratory procedures.</p>',location:'China - Shanghai',country:{descriptor:'China',id:PFIZER_CHINA},jobRequisitionLocation:{country:{descriptor:'China',alpha2Code:'CN'}}}});
test('Pfizer complete traversal isolates malformed jobs, short real descriptions and native failures',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-pfizer-china-social').plan;
 for(const mode of ['good','title','extra-bullet','two-unbound','detail-transport','detail-503','detail-429','wrong-id','foreign','duplicate','missing-page']){
  const rows=['1234567','1234568','1234569'].map(row),calls=[];
  if(mode==='title')rows[1].title='';if(mode==='extra-bullet')rows[1].bulletFields.push('Full time');if(mode==='two-unbound')rows.splice(1,2,null,null);if(mode==='duplicate')rows[1]=rows[0];
  const transport=async req=>{calls.push(req);const isList=req.method==='POST',id=req.url.match(/_(\d{7})$/)?.[1];
   if(isList)assert.equal(calls.some(c=>c.method==='GET'),false,'All list boundaries precede details');
   if(id==='1234568'&&mode==='detail-transport')throw Error('Synthetic connection failure');
   const status=id==='1234568'&&mode==='detail-503'?503:id==='1234568'&&mode==='detail-429'?429:200;
   const body=isList?JSON.stringify({total:mode==='missing-page'?21:3,jobPostings:JSON.parse(req.body).offset===0?rows:[]}):id==='1234568'&&mode==='wrong-id'?detail(id).replace('"jobReqId":"1234568"','"jobReqId":"7654321"'):id==='1234568'&&mode==='foreign'?detail(id).replaceAll('China','Japan'):detail(id);
   return {status,body,finalUrl:req.url,contentType:'application/json',capturedAt:at};
  };
  const fetched=await fetchPfizerWorkdayTraversal(plan,{http:transport,detailHttp:transport,now:()=>new Date(at)}),result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(fetched.ok,false,mode);assert.equal(calls.some(c=>c.method==='GET'),false);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  const good=['good','extra-bullet'].includes(mode)?3:mode==='two-unbound'||mode==='detail-429'?1:2;assert.equal(result.jobs.length,good,mode);
  assert.equal(replayPfizerWorkdayTraversal(plan,result.fetchEvidence,result.jobs),true,mode);
  if(mode==='detail-429')assert.equal(calls.some(c=>c.url.endsWith('_1234569')),false);
  if(!['detail-429','foreign'].includes(mode)){
   const nativeEntry='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers',listPage={url:nativeEntry+`?Location_Country=${PFIZER_CHINA}`,title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:'Page 1 of 1',range:'1 - 3 of 3 jobs',totalText:'3 JOBS FOUND',nextControlPresent:false,capturedAt:at};
   const rawRows=['1234567','1234568','1234569'].map((id,recordIndex)=>({sourceJobId:pfizerSourceJobId(path(id)),rawEvidenceId:irreversibleOfficialJsonEvidenceId(id),recordIndex,scopeMarker:'China',scopeDecision:'INCLUDED_MAINLAND',rawPayload:{officialId:id,externalPath:path(id),title:`Official role ${id}`,renderedTitle:`Official role ${id}`,renderedId:id,renderedLocations:['China - Shanghai'],applyEnabled:true,detailUrl:nativeEntry+path(id)+`?Location_Country=${PFIZER_CHINA}`,capturedAt:at,jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:id},title:`Official role ${id}`,jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Shanghai'}}}),...(recordIndex===0?{listPage}:{})}}));
   const sourceConfigSha256=sourcePlanConfigSha256(plan),binding={releaseCandidateId:'synthetic-pfizer-isolation',batchId:mode,sourceResultId:`result-${mode}`,sourceConfigSha256};
   const validation=createOfficialJsonRenderedTraversalValidation({sourceId:plan.source.id,companyId:plan.company.id,sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages:[{channelId:plan.expectedChannels[0].channelId,pageNumber:1,declaredTotalPages:1,declaredTotalJobs:3,uiRequestCandidateIds:[],rawRows,nextControlPresent:false}],observedAt:at,expiresAt:'2026-11-06T04:30:00.000Z'});
   const decision=issueBGradeTraversalCertificate({binding,plan,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,independentValidation:validation,validationExecution:'CURRENT_RUN',trigger:'INITIAL_QUALIFICATION',now:new Date(at)});
   assert.equal(decision.status,'CERTIFIED',`${mode}: ${JSON.stringify(decision)}`);assert.equal(decision.certificate.counts.finalUniqueJobCount,good);
   assert.equal(verifyBGradeTraversalCertificateReceipt({certificate:JSON.parse(JSON.stringify(decision.certificate)),certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(result.fetchEvidence.pages.flatMap(p=>p.rawJobIds))},now:new Date(at)}).status,'PASS');
  }

  if(good<3){const evidence=structuredClone(result.fetchEvidence);evidence.jobQuarantines[0].recordIndex=99;assert.equal(replayPfizerWorkdayTraversal(plan,evidence,result.jobs),false);}
 }
});
