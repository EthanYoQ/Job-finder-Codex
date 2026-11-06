import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans,sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createMsdAjingaSourceFetch,validateStrictMsdAjingaEvidence} from '../src/crawler/msdAjingaSourceFetch.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';
import {issueAGradeOfficialTotalCertificate} from '../src/crawler/completenessCertificate.ts';

test('MSD isolates bad native details after closing the original list',async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-msd-china-social');
 const company={pk:13472,root_pk:13471};
 const rows=[101,102,103].map(pk=>({pk,short_unique_id:`short${pk}`,title:`Role ${pk}`,company,job_visibility:'E',show_apply:1,finish_apply:false,cant_applied:false,is_overseas:false,url:`/job-detail-new/${pk}/c/`,apply_url:`/apply-job-process/${pk}/?company_id=${company.pk}`,cities:['上海']}));
 const at='2026-11-06T00:00:00.000Z';let bad=true,incomplete=false;
 const fetch=createMsdAjingaSourceFetch({now:()=>new Date(at),http:async url=>{
  let body,contentType='application/json';
  if(url===plan.source.officialEntryUrl){body='<script src="https://static-c.ajinga.com/v-prod/js/app.abc.js"></script>';contentType='text/html';}
  else if(url.includes('/v-prod/js/')){body='MSD:13471;professionals;/django_rest/job-list/';contentType='application/javascript';}
  else if(url.includes('/job-list/'))body=JSON.stringify({code:200,data:{count:3,list:incomplete?rows.slice(0,2):rows,isLastPage:true,cant_applied:false}});
  else{
   const row=rows.find(r=>url.includes(r.short_unique_id));assert.ok(row);
   body=url.includes('/info/')?JSON.stringify({code:200,data:{data:{is_in_china:true,company:{id:company.pk,root_company:{id:13471}},job:{id:row.pk,root_company_id:13471,company:{id:company.pk},short_unique_id:row.short_unique_id,i18n_name:row.title,job_visibility:'E',description:bad&&row.pk===102?'':'Official responsibilities',job_locations:[{city:{cn_name:'上海',name:'Shanghai'}}]}}}}):JSON.stringify({code:200,data:{show_apply:1,normal_share_url:`https://www.ajinga.com/recruiting/company/${company.pk}/job/${row.pk}/job-detail`}});
  }
  return {status:200,body,finalUrl:url,contentType,capturedAt:at};
 }});
 const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
 assert.equal(result.truth.completenessVerified,true);assert.deepEqual(result.jobs.map(j=>j.sourceJobId),['ajinga:101','ajinga:103']);
 assert.equal(result.fetchEvidence.jobQuarantines[0].sourceJobId,'ajinga:102');
 assert.deepEqual(result.fetchEvidence.fetchCounts,{rawCount:3,parsedCount:3,validCount:2,parseDiscardCount:0,validationDiscardCount:1});
 const evidence=result.fetchEvidence,official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
 const decision=issueAGradeOfficialTotalCertificate({binding:{releaseCandidateId:'test',batchId:'test',sourceResultId:'test',sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
 assert.equal(decision.status,'CERTIFIED',JSON.stringify(decision));
 const changed=structuredClone(evidence);changed.jobQuarantines[0].sourceJobId='ajinga:101';assert.equal(validateStrictMsdAjingaEvidence(plan,changed,result.jobs),false);
 bad=false;const good=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(good.truth.completenessVerified,true);assert.equal(good.jobs.length,3);
 incomplete=true;const missing=await runSourceCrawl(plan,{fetch,isBaseline:false});assert.equal(missing.truth.completenessVerified,false);
});
