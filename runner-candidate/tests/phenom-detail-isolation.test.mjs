import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {rocheNativeDetailUrl} from '../src/crawler/rocheChinaQuality.ts';
import {issueAGradeOfficialTotalCertificate} from '../src/crawler/completenessCertificate.ts';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createHash} from 'node:crypto';
const at='2026-11-06T00:00:00.000Z';
for(const family of ['lilly','organon','roche'])test(`${family}: complete native list survives one bad job detail or row`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===`source-${family}-china-social`),roche=family==='roche',organon=family==='organon';
 const sample=roche?{title:'Synthetic Role',applyUrl:'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply',reqId:'202609-123373',postedDate:'2026-09-30T00:00:00.000+0000',country:'中国大陆',location:'上海, 中国大陆',multi_location:['上海, 中国大陆'],siteType:'external',visibilityType:'External',jobVisibility:['external'],locale:'zh_cn'}:JSON.parse(readFileSync(new URL(`./fixtures/${family}-location-change.json`,import.meta.url)));
 const origin=roche?'https://careers.roche.com':organon?'https://jobs.organon.com':'https://careers.lilly.com';
 const bootstrap={widgetApiEndpoint:origin+'/widgets',country:roche||organon?'cn':'us',deviceType:'desktop',locale:roche||organon?'zh_cn':'en_us',refNum:roche?'ROCHGLOBAL':organon?'MECEUS':'LILLUS',pageName:'search-results',pageId:organon?'page18-ds':'page11-ds'};
 for(const mode of ['good','detail-503','wrong-detail-id','missing-title','non-object','429',...(!roche?['closed-and-invalid']:[])]){
  const rows=[1,2,3].map(i=>{const reqId=roche?`202609-${123370+i}`:organon?`R${543100+i}`:`R-${800000+i}`;return {...sample,reqId,jobId:reqId,jobSeqNo:roche?`ROCHGLOBAL${reqId.replace('-','')}EXTERNALZHCN`:organon?`MECEUS${reqId}ZHCN`:`LILLUS${reqId.replace('-','')}EXTERNALENUS`,applyUrl:sample.applyUrl.replace(sample.reqId,reqId)};});
  if(mode==='missing-title'||mode==='closed-and-invalid')rows[1].title='';if(mode==='non-object')rows[1]=null;
  let posts=0,detailCalls=0;
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url,method})=>{
   let body,contentType='text/html',status=200;
   if(url===plan.source.officialEntryUrl)body=`<script>var phApp=${JSON.stringify(bootstrap)};${organon?`phApp.ddo=${JSON.stringify({eagerLoadRefineSearch:{status:200,totalHits:3,hits:3,data:{keywords:'China',jobs:rows}}})};`:''}</script>`;
   else if(method==='POST'){
    const index=posts++,jobs=roche&&index===0?[]:rows;
    body=JSON.stringify({refineSearch:{status:200,totalHits:3,hits:jobs.length,data:{jobs,aggregations:roche&&index===0?[{field:'country',value:{中国大陆:3}}]:[],ui_selections:roche&&index===0?{}:{country:[roche?'中国大陆':'China']}}}});contentType='application/json';
   }else{
    const row=rows.find(r=>r&&(roche?rocheNativeDetailUrl(r):r.applyUrl)===url);assert.ok(row,url);detailCalls++;
    if(row===rows[1]&&['detail-503','429'].includes(mode))status=mode==='429'?429:503;
    const id=row===rows[1]&&mode==='wrong-detail-id'?'WRONG-ID':row.reqId;
    if(roche){contentType='application/json';body=JSON.stringify({jobPostingInfo:{title:row.title,jobReqId:id,jobPostingId:new URL(row.applyUrl).pathname.split('/').at(-2),jobPostingSiteId:'roche-ext',externalUrl:row.applyUrl.replace(/\/apply$/u,''),location:'Shanghai',country:{descriptor:'China'},posted:true,canApply:true,jobDescription:'Synthetic complete official duties',startDate:'2026-09-30'}});}
    else body=`<script>window.workday=${organon?"window.workday||{tenant:'organon',siteId:'SearchJobs',postingAvailable:true}":'{postingAvailable:true}'};</script><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:id},title:row.title,description:'Synthetic complete official duties',jobLocation:{address:{addressCountry:'China',addressLocality:organon?new URL(row.applyUrl).pathname.split('/')[3].replaceAll('---',' - '):'CN: Bao Ding'}}})}</script>`;
    if(mode==='closed-and-invalid'&&row===rows[2])body=`<meta property="og:url" content="${url}"><script>window.workday=${organon?"window.workday||{tenant:'organon',siteId:'SearchJobs',postingAvailable:false}":"{tenant:'lilly',siteId:'LLY',postingAvailable:false}"};</script>`;
   }
   return {status,body,finalUrl:url,contentType,capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='good'?3:mode==='closed-and-invalid'||mode==='429'&&organon?1:2,mode);
  const evidence=result.fetchEvidence,official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
  const decision=issueAGradeOfficialTotalCertificate({binding:{releaseCandidateId:'synthetic',batchId:'synthetic',sourceResultId:'synthetic-source',sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
  assert.equal(decision.status,'CERTIFIED',`${mode}: ${JSON.stringify(decision)}`);
  if(mode!=='good'){const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
  if(mode==='429'&&organon)assert.equal(detailCalls,2);
 }
});
