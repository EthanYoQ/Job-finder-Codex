import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {replayBiArchivedSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {withLocalOfficialDom} from '../src/crawler/localOfficialSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {biJobQuarantine,biRawObservationId} from '../src/crawler/biSemanticCompleteness.ts';
import {replayBiUiSemanticContract,BI_API_URL,BI_SCRIPT_URL} from '../src/crawler/biUiSemanticContract.ts';

const row=id=>({ctmid:'3479',jobid:String(id),coid:'3479',coname:'Synthetic company',jobname:`Role ${id}`,jobareaname:'上海',workareaname:'上海',ejobareaname:'Shanghai',eworkareaname:'Shanghai',address:'中国上海'});
test('BI: unidentified list rows keep physical positions and valid foreign conflicts stay isolated',()=>{
 assert.equal(biJobQuarantine(row(1),0),undefined);
 assert.notEqual(biRawObservationId(null,0),biRawObservationId(null,1));
 for(const raw of [null,{...row(2),jobname:''},{...row(2),ctmid:'other'},{...row(2),workareaname:'Tokyo'}])assert(biJobQuarantine(raw,1));
});

// Archived public script is supplied locally; test metadata and job rows are synthetic.
test('BI: full archived API replay updates good jobs while quarantining damaged individual rows',{skip:!process.env.JOBFINDER_BI_SCRIPT},async()=>{
 const script=await readFile(process.env.JOBFINDER_BI_SCRIPT,'utf8'),ui=replayBiUiSemanticContract(script);assert(ui);
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-boehringer-ingelheim-china-social'),at='2026-11-06T00:00:00.000Z';
 const locator='51job-coapi-v1|jsonp:$.resultbody.joblist|total:$.resultbody.totalnum|ui:sxsPosCode|business-request-v1|'+JSON.stringify({method:'GET',baseUrl:BI_API_URL,params:ui.params,jsoncallback:'jsoncallback'});
 for(const mode of ['good','title','foreign','two-unidentified','two-invalid-ids','duplicate','missing-list']){
  const rows=[row(1),row(2)];if(mode==='title')rows[1].jobname='';if(mode==='foreign')rows[1].workareaname='Tokyo';if(mode==='two-unidentified')rows.push(null,null);if(mode==='duplicate')rows[1]=row(1);
  if(mode==='two-invalid-ids')rows.push({...row(3),jobid:'broken'},{...row(3),jobid:'broken'});
  const body='jsoncallback('+JSON.stringify({status:'1',message:'接口调用成功',resultbody:{totalnum:String(rows.length+(mode==='missing-list'?1:0)),joblist:rows}})+')';
  const artifacts=[{id:'51job-ui-script',logicalKey:'51job-ui-script',kind:'OFFICIAL_COMPANY_PAGE',requestedUrl:BI_SCRIPT_URL,finalUrl:BI_SCRIPT_URL,httpStatus:200,contentType:'application/javascript',capturedAt:at,body:script,extractorLocator:'javascript:sxsPosCode[code,jobareaname]'},
   {id:'51job-page-0001',logicalKey:'51job-page-0001',kind:'ATS_API_RESPONSE',requestedUrl:BI_API_URL,finalUrl:BI_API_URL,httpStatus:200,contentType:'application/javascript',capturedAt:at,body,extractorLocator:locator}];
  const fetched=replayBiArchivedSourceFetch(plan,artifacts,at);
  if(['duplicate','missing-list'].includes(mode)){assert.equal(fetched.ok,false,mode);continue;}
  const now=new Date().toISOString(),dom={source_url:plan.source.officialEntryUrl,captured_at:now,jobs:rows.flatMap(raw=>raw&&raw.jobid?[{jobId:raw.jobid,href:`/BI/recruit_article_detail3.html?jobId=${raw.jobid}`,visible:true,title:raw.jobname,location:raw.jobareaname}]:[])};
  // The native UI may omit an unidentified damaged row; it must still contain every verified ID.
  if(mode==='two-invalid-ids')dom.jobs=dom.jobs.filter(r=>r.jobId!=='broken');
  const fetch=withLocalOfficialDom(async()=>fetched,async()=>({dom}));
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify(result.observation)}`);
  assert.equal(result.jobs.length,['title','foreign'].includes(mode)?1:2,mode);
  if(mode!=='good'){
   const evidence=structuredClone(result.fetchEvidence);assert.equal(evidence.jobQuarantines.length,['two-unidentified','two-invalid-ids'].includes(mode)?2:1);
   evidence.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);
  }
 }
});
