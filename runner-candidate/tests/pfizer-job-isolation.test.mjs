import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {fetchPfizerWorkdayTraversal,PFIZER_API,PFIZER_ENTRY,PFIZER_CHINA,replayPfizerWorkdayTraversal} from '../src/crawler/pfizerWorkdayTraversal.ts';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {irreversibleOfficialJsonEvidenceId} from '../src/crawler/officialJsonEvidence.ts';
import {canonicalStringSetSha256} from '../src/crawler/sourceFetchEvidence.ts';
import {pfizerSourceJobId} from '../src/crawler/pfizerWorkdayTraversal.ts';
import {createOfficialJsonRenderedTraversalValidation,issueBGradeTraversalCertificate,verifyBGradeTraversalCertificateReceipt} from '../src/crawler/traversalCertificate.ts';
import {isolateIndependentJobs} from '../src/crawler/independentJobQuarantine.ts';
import {pfizerQuarantinedEvidenceKey} from '../src/crawler/pfizerWorkdayTraversal.ts';
import {pfizerDomListSlots} from '../src/crawler/pfizerRenderedTraversal.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
const at='2026-11-06T04:00:00.000Z',path=id=>`/job/Shanghai/Role_${id}`,row=id=>({title:`List ${id}`,bulletFields:[id],externalPath:path(id)});
const detail=id=>JSON.stringify({jobPostingInfo:{jobReqId:id,title:`Official role ${id}`,jobPostingSiteId:'PfizerCareers',externalUrl:PFIZER_ENTRY+path(id),posted:true,canApply:true,jobDescription:'<p>Research laboratory procedures.</p>',location:'China - Shanghai',country:{descriptor:'China',id:PFIZER_CHINA},jobRequisitionLocation:{country:{descriptor:'China',alpha2Code:'CN'}}}});
test('Pfizer complete traversal isolates malformed jobs, short real descriptions and native failures',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-pfizer-china-social').plan;
 for(const mode of ['good','title','extra-bullet','two-unbound','detail-transport','detail-503','detail-429','wrong-id','independent-detail','independent-unbound','independent-combined-unbound','foreign','duplicate','missing-page']){
  const rows=['1234567','1234568','1234569'].map(row),calls=[];
  if(mode==='title')rows[1].title='';if(mode==='extra-bullet')rows[1].bulletFields.push('Full time');if(mode==='two-unbound')rows.splice(1,2,null,null);if(mode==='duplicate')rows[1]=rows[0];
  const transport=async req=>{calls.push(req);const isList=req.method==='POST',id=req.url.match(/_(\d{7})$/)?.[1];
   if(isList)assert.equal(calls.some(c=>c.method==='GET'),false,'All list boundaries precede details');
   if(id==='1234568'&&mode==='detail-transport')throw Error('Synthetic connection failure');
   const status=id==='1234568'&&['detail-503','independent-combined-unbound'].includes(mode)?503:id==='1234568'&&mode==='detail-429'?429:200;
   const body=isList?JSON.stringify({total:mode==='missing-page'?21:3,jobPostings:JSON.parse(req.body).offset===0?rows:[]}):id==='1234568'&&mode==='wrong-id'?detail(id).replace('"jobReqId":"1234568"','"jobReqId":"7654321"'):id==='1234568'&&mode==='foreign'?detail(id).replaceAll('China','Japan'):detail(id);
   return {status,body,finalUrl:req.url,contentType:'application/json',capturedAt:at};
  };
  const fetched=await fetchPfizerWorkdayTraversal(plan,{http:transport,detailHttp:transport,now:()=>new Date(at)});let result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  if(['duplicate','missing-page'].includes(mode)){assert.equal(fetched.ok,false,mode);assert.equal(calls.some(c=>c.method==='GET'),false);continue;}
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  const good=['good','extra-bullet','independent-detail','independent-unbound'].includes(mode)?3:mode==='two-unbound'||mode==='detail-429'?1:2;assert.equal(result.jobs.length,good,mode);
  assert.equal(replayPfizerWorkdayTraversal(plan,result.fetchEvidence,result.jobs),true,mode);
  if(mode==='detail-429')assert.equal(calls.some(c=>c.url.endsWith('_1234569')),false);
  if(!['detail-429','foreign'].includes(mode)){
   const nativeEntry='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers',listPage={url:nativeEntry+`?Location_Country=${PFIZER_CHINA}`,title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:'Page 1 of 1',range:'1 - 3 of 3 jobs',totalText:'3 JOBS FOUND',nextControlPresent:false,capturedAt:at};
   const rawRows=['1234567','1234568','1234569'].map((id,recordIndex)=>({sourceJobId:pfizerSourceJobId(path(id)),rawEvidenceId:irreversibleOfficialJsonEvidenceId(id),recordIndex,scopeMarker:'China',scopeDecision:'INCLUDED_MAINLAND',rawPayload:{officialId:id,externalPath:path(id),title:`Official role ${id}`,renderedTitle:`Official role ${id}`,renderedId:id,renderedLocations:['China - Shanghai'],applyEnabled:true,detailUrl:nativeEntry+path(id)+`?Location_Country=${PFIZER_CHINA}`,capturedAt:at,jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:id},title:`Official role ${id}`,jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Shanghai'}}}),...(recordIndex===0?{listPage}:{})}}));
   if(mode==='independent-detail'){const id='1234568';rawRows[1]={sourceJobId:pfizerQuarantinedEvidenceKey(id),rawEvidenceId:irreversibleOfficialJsonEvidenceId(id),recordIndex:1,scopeMarker:'UNKNOWN',scopeDecision:'EXCLUDED_AUDITED',rawPayload:{officialId:id,title:`List ${id}`,detailUrl:nativeEntry+path(id)+`?Location_Country=${PFIZER_CHINA}`,quarantineCode:'PFIZER_DETAIL_UNVERIFIED',noOmissionVerified:false,capturedAt:at,detailFailure:{code:'NATIVE_DETAIL_UNVERIFIED',httpStatus:503}}};}
   if(['independent-unbound','independent-combined-unbound'].includes(mode)){
    listPage.physicalRows=['1234567','1234568','1234569'].map(id=>({html:id==='1234568'?'<li>Unidentified original job</li>':`<li>${id}</li>`,cards:id==='1234568'?[]:[{href:nativeEntry+path(id)+`?Location_Country=${PFIZER_CHINA}`,title:`Official role ${id}`}]}));listPage.cards=listPage.physicalRows.flatMap(r=>r.cards);
    const slot=pfizerDomListSlots(listPage)[1];assert.equal(slot.unidentified,true);
    rawRows[1]={sourceJobId:pfizerQuarantinedEvidenceKey(slot.officialId),rawEvidenceId:irreversibleOfficialJsonEvidenceId(slot.officialId),recordIndex:1,scopeMarker:'UNKNOWN_IDENTITY',scopeDecision:'EXCLUDED_AUDITED',rawPayload:{officialId:slot.officialId,quarantineCode:'PFIZER_LIST_IDENTITY_UNRESOLVED',noOmissionVerified:false,domRow:slot.domRow,domPage:listPage,capturedAt:at}};
   }
   const sourceConfigSha256=sourcePlanConfigSha256(plan),binding={releaseCandidateId:'synthetic-pfizer-isolation',batchId:mode,sourceResultId:`result-${mode}`,sourceConfigSha256};
   const validation=createOfficialJsonRenderedTraversalValidation({sourceId:plan.source.id,companyId:plan.company.id,sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages:[{channelId:plan.expectedChannels[0].channelId,pageNumber:1,declaredTotalPages:1,declaredTotalJobs:3,uiRequestCandidateIds:[],rawRows,nextControlPresent:false}],observedAt:at,expiresAt:'2026-11-06T04:30:00.000Z'});
   result=isolateIndependentJobs(plan,result,validation.pages);
   const decision=issueBGradeTraversalCertificate({binding,plan,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,independentValidation:validation,validationExecution:'CURRENT_RUN',trigger:'INITIAL_QUALIFICATION',now:new Date(at)});
   assert.equal(decision.status,'CERTIFIED',`${mode}: ${JSON.stringify(decision)}`);assert.equal(decision.certificate.counts.finalUniqueJobCount,['independent-detail','independent-unbound','independent-combined-unbound'].includes(mode)?2:good);
   assert.equal(verifyBGradeTraversalCertificateReceipt({certificate:JSON.parse(JSON.stringify(decision.certificate)),certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(result.fetchEvidence.pages.flatMap(p=>p.rawJobIds))},now:new Date(at)}).status,'PASS');
  }

  if(good<3){const evidence=structuredClone(result.fetchEvidence);evidence.jobQuarantines[0].recordIndex=99;assert.equal(replayPfizerWorkdayTraversal(plan,evidence,result.jobs),false);}
 }
});

test('Pfizer second-page unbound rows and converted foreign exclusions replay with distinct capture times',async()=>{
 const plan=(await loadDirectPlans()).find(p=>p.sourceId==='source-pfizer-china-social').plan,nativeEntry='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers';
 for(const foreign of [false,true]){
  const ids=Array.from({length:21},(_,i)=>String(1234501+i));let clock=Date.parse(at);const timestamp=()=>new Date(clock+=100).toISOString();
  const transport=async request=>{const isList=request.method==='POST',id=request.url.match(/_(\d{7})$/u)?.[1];
   const body=isList?JSON.stringify({total:21,jobPostings:ids.slice(JSON.parse(request.body).offset,JSON.parse(request.body).offset+20).map(row)}):foreign&&id===ids[20]?detail(id).replaceAll('China','India'):detail(id);
   return {status:200,body,finalUrl:request.url,contentType:'application/json',capturedAt:timestamp()};
  };
  let result=await runSourceCrawl(plan,{fetch:()=>fetchPfizerWorkdayTraversal(plan,{http:transport,detailHttp:transport,now:()=>new Date(clock)}),isBaseline:false});assert.equal(result.jobs.length,foreign?20:21);
  const observedAt=timestamp(),pages=[0,1].map(pageIndex=>{
   const own=ids.slice(pageIndex*20,pageIndex*20+20),listPage={url:nativeEntry+`?Location_Country=${PFIZER_CHINA}`,title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:`Page ${pageIndex+1} of 2`,range:pageIndex?'21 - 21 of 21 jobs':'1 - 20 of 21 jobs',totalText:'21 JOBS FOUND',nextControlPresent:pageIndex===0,capturedAt:pageIndex?timestamp():observedAt};
   if(pageIndex){listPage.physicalRows=[{html:'<li>Unidentified original job</li>',cards:[]}];listPage.cards=[];}
   const rawRows=own.map((id,recordIndex)=>{
    if(pageIndex){const slot=pfizerDomListSlots(listPage)[0];return {sourceJobId:pfizerQuarantinedEvidenceKey(slot.officialId),rawEvidenceId:irreversibleOfficialJsonEvidenceId(slot.officialId),recordIndex,scopeMarker:'UNKNOWN_IDENTITY',scopeDecision:'EXCLUDED_AUDITED',rawPayload:{officialId:slot.officialId,quarantineCode:'PFIZER_LIST_IDENTITY_UNRESOLVED',noOmissionVerified:false,domRow:slot.domRow,domPage:listPage,listPage,capturedAt:timestamp()}};}
    return {sourceJobId:pfizerSourceJobId(path(id)),rawEvidenceId:irreversibleOfficialJsonEvidenceId(id),recordIndex,scopeMarker:'China',scopeDecision:'INCLUDED_MAINLAND',rawPayload:{officialId:id,externalPath:path(id),title:`Official role ${id}`,renderedTitle:`Official role ${id}`,renderedId:id,renderedLocations:['China - Shanghai'],applyEnabled:true,detailUrl:nativeEntry+path(id)+`?Location_Country=${PFIZER_CHINA}`,capturedAt:timestamp(),jsonLd:JSON.stringify({'@type':'JobPosting',identifier:{value:id},title:`Official role ${id}`,jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Shanghai'}}}),...(recordIndex===0?{listPage}:{})}};
   });
   return {channelId:plan.expectedChannels[0].channelId,pageNumber:pageIndex+1,declaredTotalPages:2,declaredTotalJobs:21,uiRequestCandidateIds:[],rawRows,nextControlPresent:pageIndex===0};
  });
  const sourceConfigSha256=sourcePlanConfigSha256(plan),binding={releaseCandidateId:'synthetic-pfizer-timestamps',batchId:`foreign-${foreign}`,sourceResultId:`result-${foreign}`,sourceConfigSha256};
  const validation=createOfficialJsonRenderedTraversalValidation({sourceId:plan.source.id,companyId:plan.company.id,sourceConfigSha256,surfaceIds:[plan.source.surfaceId],channelIds:plan.expectedChannels.map(c=>c.channelId),pages,observedAt,expiresAt:new Date(clock+1800000).toISOString()});
  result=isolateIndependentJobs(plan,result,validation.pages);assert.equal(result.jobs.length,20);assert.equal(replayPfizerWorkdayTraversal(plan,result.fetchEvidence,result.jobs),true);
  assert.equal(result.fetchEvidence.jobQuarantines[0].recordIndex,0);assert.equal(result.fetchEvidence.jobQuarantines[0].pageSequence,1);assert.equal(result.fetchEvidence.fetchLosses.at(-1).recordedAt,result.fetchEvidence.pages[0].capturedAt);
  const decision=issueBGradeTraversalCertificate({binding,plan,transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,independentValidation:validation,validationExecution:'CURRENT_RUN',trigger:'INITIAL_QUALIFICATION',now:new Date(clock)});assert.equal(decision.status,'CERTIFIED',JSON.stringify(decision));
  assert.equal(verifyBGradeTraversalCertificateReceipt({certificate:JSON.parse(JSON.stringify(decision.certificate)),certificateSha256:decision.certificateSha256,expected:{...binding,sourceId:plan.source.id,canonicalRawEvidenceIdSetSha256:canonicalStringSetSha256(result.fetchEvidence.pages.flatMap(p=>p.rawJobIds))},now:new Date(clock)}).status,'PASS');
 }
});
