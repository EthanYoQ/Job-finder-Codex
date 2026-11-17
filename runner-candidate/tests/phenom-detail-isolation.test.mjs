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
 for(const mode of ['good','redirect','list-and-detail','detail-503','wrong-detail-id','missing-title','non-object','two-unidentified','429','all-429','reverse-closed',...(!roche?['closed-and-invalid','verified-empty']:[])]){
  const rows=[1,2,3].map(i=>{const reqId=roche?`202609-${123370+i}`:organon?`R${543100+i}`:`R-${800000+i}`;return {...sample,reqId,jobId:reqId,jobSeqNo:roche?`ROCHGLOBAL${reqId.replace('-','')}EXTERNALZHCN`:organon?`MECEUS${reqId}ZHCN`:`LILLUS${reqId.replace('-','')}EXTERNALENUS`,applyUrl:sample.applyUrl.replace(sample.reqId,reqId)};});
  if(mode==='verified-empty')rows.length=0;
  if(mode==='list-and-detail')rows[0].title='';if(mode==='missing-title'||mode==='closed-and-invalid')rows[1].title='';if(mode==='non-object')rows[1]=null;
  if(mode==='two-unidentified')rows[1]=rows[2]=null;
  let posts=0,detailCalls=0;
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url,method})=>{
   let body,contentType='text/html',status=200,delay=false;
   if(url===plan.source.officialEntryUrl)body=`<script>var phApp=${JSON.stringify(bootstrap)};${organon?`phApp.ddo=${JSON.stringify({eagerLoadRefineSearch:{status:200,totalHits:rows.length,hits:rows.length,data:{keywords:'China',jobs:rows}}})};`:''}</script>`;
   else if(method==='POST'){
    const index=posts++,jobs=roche&&index===0?[]:rows;
    body=JSON.stringify({refineSearch:{status:200,totalHits:rows.length,hits:jobs.length,data:{jobs,aggregations:roche&&index===0?[{field:'country',value:{中国大陆:rows.length}}]:[],ui_selections:roche&&index===0?{}:{country:[roche?'中国大陆':'China']}}}});contentType='application/json';
   }else{
    const row=rows.find(r=>r&&(roche?rocheNativeDetailUrl(r):r.applyUrl)===url);assert.ok(row,url);detailCalls++;
    if(row===rows[1]&&['detail-503','429','list-and-detail'].includes(mode))status=mode==='429'?429:503;
    if(mode==='all-429')status=429;
    const id=row===rows[1]&&mode==='wrong-detail-id'?'WRONG-ID':row.reqId;
    if(roche){contentType='application/json';body=JSON.stringify({jobPostingInfo:{title:row.title,jobReqId:id,jobPostingId:new URL(row.applyUrl).pathname.split('/').at(-2),jobPostingSiteId:'roche-ext',externalUrl:row.applyUrl.replace(/\/apply$/u,''),location:'Shanghai',country:{descriptor:'China'},posted:true,canApply:true,jobDescription:'Synthetic complete official duties',startDate:'2026-09-30'}});}
    else body=`<script>window.workday=${organon?"window.workday||{tenant:'organon',siteId:'SearchJobs',postingAvailable:true}":'{postingAvailable:true}'};</script><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:id},title:row.title,description:'Synthetic complete official duties',jobLocation:{address:{addressCountry:'China',addressLocality:organon?new URL(row.applyUrl).pathname.split('/')[3].replaceAll('---',' - '):'CN: Bao Ding'}}})}</script>`;
    if(mode==='closed-and-invalid'&&row===rows[2])body=`<meta property="og:url" content="${url}"><script>window.workday=${organon?"window.workday||{tenant:'organon',siteId:'SearchJobs',postingAvailable:false}":"{tenant:'lilly',siteId:'LLY',postingAvailable:false}"};</script>`;
    if(mode==='reverse-closed'&&row!==rows[2]){
     if(roche){status=403;body=JSON.stringify({errorCode:'S22',httpStatus:403,message:'permission denied'});}
     else body=`<meta property="og:url" content="${url}"><script>window.workday=${organon?"window.workday||{tenant:'organon',siteId:'SearchJobs',postingAvailable:false}":"{tenant:'lilly',siteId:'LLY',postingAvailable:false}"};</script>`;
     delay=row===rows[0];
    }
   }
   if(delay)await new Promise(resolve=>setImmediate(resolve));
   return {status,body,finalUrl:mode==='redirect'&&method!=='POST'&&url!==plan.source.officialEntryUrl&&rows[1]&&(roche?rocheNativeDetailUrl(rows[1]):rows[1].applyUrl)===url?'https://login.example.invalid/error':url,contentType,capturedAt:at,
     ...(status===429?{retryAfter:{value:'2700',delayMs:2700000}}:{})};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  if(mode==='429'||mode==='all-429'){
   assert.equal(result.truth.transportSuccess,false,`${mode}: a rate-limited detail traversal cannot refresh the source`);
   assert.equal(result.truth.completenessVerified,false);
   assert.deepEqual(result.transportFailure,{code:'OFFICIAL_HTTP_429',retryable:true,retryAfterMs:2700000});
   assert.equal(result.fetchEvidence.declaredCompleteness.value,3);
   assert.equal(result.fetchEvidence.artifacts.filter(artifact=>artifact.httpStatus===429).length,1);
   assert.equal(detailCalls,mode==='429'?2:1);
   continue;
  }
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(result.jobs.length,mode==='verified-empty'?0:mode==='good'?3:['list-and-detail','closed-and-invalid','reverse-closed','two-unidentified'].includes(mode)?1:2,mode);
  if(mode==='verified-empty')assert.equal(detailCalls,0);
  if(mode==='list-and-detail')assert.equal(result.fetchEvidence.jobQuarantines.length,2);
  const evidence=result.fetchEvidence,official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
  const decision=issueAGradeOfficialTotalCertificate({binding:{releaseCandidateId:'synthetic',batchId:'synthetic',sourceResultId:'synthetic-source',sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
  assert.equal(decision.status,'CERTIFIED',`${mode}: ${JSON.stringify(decision)}`);
  if(result.fetchEvidence.jobQuarantines?.length){const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
  if(mode==='reverse-closed')assert.deepEqual(result.fetchEvidence.fetchLosses.map(loss=>loss.details.recordIndex),[0,1]);
 }
});
