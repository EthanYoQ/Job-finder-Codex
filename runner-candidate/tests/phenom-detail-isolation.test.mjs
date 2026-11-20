import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {candidateCompanies} from '../src/data/companyRegistry.ts';
import {buildStagedSourceCrawlPlans} from '../src/crawler/sourcePlan.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runSourceCrawl,replayStrictSourceQualityEvidence} from '../src/crawler/runSourceCrawl.ts';
import {issueAGradeOfficialTotalCertificate} from '../src/crawler/completenessCertificate.ts';
import {sourcePlanConfigSha256} from '../src/crawler/sourcePlan.ts';
import {createHash} from 'node:crypto';
const at='2026-11-06T00:00:00.000Z';
for(const family of ['lilly','organon','roche'])test(`${family}: complete native list survives one bad job detail or row`,async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===`source-${family}-china-social`),roche=family==='roche',organon=family==='organon';
 const sample=roche?{title:'Synthetic Role',applyUrl:'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply',reqId:'202609-123373',postedDate:'2026-09-30T00:00:00.000+0000',country:'中国大陆',location:'上海, 中国大陆',multi_location:['上海, 中国大陆'],siteType:'external',visibilityType:'External',jobVisibility:['external'],locale:'zh_cn'}:JSON.parse(readFileSync(new URL(`./fixtures/${family}-location-change.json`,import.meta.url)));
 const origin=roche?'https://careers.roche.com':organon?'https://jobs.organon.com':'https://careers.lilly.com';
 const bootstrap={widgetApiEndpoint:origin+'/widgets',country:roche||organon?'cn':'us',deviceType:'desktop',locale:roche||organon?'zh_cn':'en_us',refNum:roche?'ROCHGLOBAL':organon?'MECEUS':'LILLUS',pageName:'search-results',pageId:organon?'page18-ds':'page11-ds'};
 const modes=['good','missing-title','non-object','two-unidentified',...(!roche?['verified-empty']:[])];
 for(const mode of modes){
  const rows=[1,2,3].map(i=>{const reqId=roche?`202609-${123370+i}`:organon?`R${543100+i}`:`R-${800000+i}`;return {...sample,reqId,jobId:reqId,jobSeqNo:roche?`ROCHGLOBAL${reqId.replace('-','')}EXTERNALZHCN`:organon?`MECEUS${reqId}ZHCN`:`LILLUS${reqId.replace('-','')}EXTERNALENUS`,applyUrl:sample.applyUrl.replace(sample.reqId,reqId)};});
  if(mode==='verified-empty')rows.length=0;
  if(mode==='missing-title')rows[1].title='';if(mode==='non-object')rows[1]=null;
  if(mode==='two-unidentified')rows[1]=rows[2]=null;
  let posts=0,detailCalls=0;
  const fetch=createOfficialJsonSourceFetch({now:()=>new Date(at),http:async({url,method})=>{
   let body,contentType='text/html',status=200;
   if(url===plan.source.officialEntryUrl)body=`<script>var phApp=${JSON.stringify(bootstrap)};${organon?`phApp.ddo=${JSON.stringify({eagerLoadRefineSearch:{status:200,totalHits:rows.length,hits:rows.length,data:{keywords:'China',jobs:rows}}})};`:''}</script>`;
   else if(method==='POST'){
    const index=posts++,jobs=roche&&index===0?[]:roche&&index===1?[sample]:rows;
    body=JSON.stringify({refineSearch:{status:200,totalHits:rows.length,hits:jobs.length,data:{jobs,aggregations:roche&&index===0?[{field:'country',value:{中国大陆:rows.length}}]:[],ui_selections:roche&&index===0?{}:{country:[roche?'中国大陆':'China']}}}});contentType='application/json';
   }else{
    detailCalls++;
    assert.fail(`Unexpected detail request for ${family}: ${url}`);
   }
   return {status,body,finalUrl:url,contentType,capturedAt:at};
  }});
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,`${mode}: ${JSON.stringify({truth:result.truth,observation:result.observation})}`);
  assert.equal(detailCalls,0,`${family} ${mode} must make zero Workday detail requests`);
  assert.equal(result.jobs.length,mode==='verified-empty'?0:mode==='good'?3:mode==='two-unidentified'?1:2,mode);
  const evidence=result.fetchEvidence,official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness.artifactLogicalKey);
  const decision=issueAGradeOfficialTotalCertificate({binding:{releaseCandidateId:'synthetic',batchId:'synthetic',sourceResultId:'synthetic-source',sourceConfigSha256:sourcePlanConfigSha256(plan)},plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
  assert.equal(decision.status,'CERTIFIED',`${mode}: ${JSON.stringify(decision)}`);
  if(result.fetchEvidence.jobQuarantines?.length){const bad=structuredClone(result.fetchEvidence);bad.jobQuarantines[0].sourceJobId='wrong';assert.equal(replayStrictSourceQualityEvidence({plan,evidence:bad,paginationEvaluation:result.paginationEvaluation,reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:at}),false);}
 }
});
