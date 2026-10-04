// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { runWithOfficialSourceCancellation } from '../../src/crawler/officialHttpRuntimeLimits';
afterEach(()=>vi.unstubAllGlobals());
import { createHash } from 'node:crypto';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { createOfficialJsonSourceFetch } from '../../src/crawler/officialJsonSourceFetch';
import { runSourceCrawl } from '../../src/crawler/runSourceCrawl';
import { beisenNativePublishedAt } from '../../src/crawler/beisenDetailDates';
import { issueAGradeOfficialTotalCertificate } from '../../src/crawler/completenessCertificate';
const NOW='2026-10-02T12:00:00.000Z';
const row={Id:'996c5ddb-d458-46fb-8c20-51a866aab785',JobAdName:'灌装工(J12634)',Category:'社会招聘',CategoryId:'1',Kind:'全职',Status:1,LocNames:['上海市·闵行区'],Duty:'生产操作',Require:'大专学历',PostDate:'2020-01-02T11:04:07',PostDateInt:1577934247000};
async function candidate(id='source-shanghai-pharma-social',detail:object=row){
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===id)!;
  const requests:string[]=[];
  const fetched=await createOfficialJsonSourceFetch({now:()=>new Date(NOW),http:async request=>{
    requests.push(request.url);
    return {status:200,finalUrl:request.url,contentType:'application/json',capturedAt:NOW,body:JSON.stringify(request.url.includes('GetJobAdInfo')?{Code:200,Data:detail}:{Code:200,Count:1,Data:[{...row,PostDate:'0001-01-01T00:00:00',PostDateInt:0}]})};
  }})(plan);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  const evidence=result.fetchEvidence!,artifact=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness?.artifactLogicalKey)!;
  return {requests,result,plan,evidence,jobs:result.jobs,reconciliation:result.reconciliation!,paginationEvaluation:result.paginationEvaluation!,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,
    officialArtifactSha256:createHash('sha256').update(artifact.body).digest('hex'),binding:{releaseCandidateId:'synthetic-beisen-date',batchId:'synthetic-beisen-date',sourceResultId:'synthetic-beisen-date',sourceConfigSha256:sourcePlanConfigSha256(plan)}};
}
it.each(['source-cttq-social','source-shanghai-pharma-social'])('binds %s old active native detail dates without a time cutoff',async(id)=>{
  const input=await candidate(id);
  expect(input.jobs).toHaveLength(1);
  expect(input.jobs[0]!.officialPublishedAt).toBe('2020-01-02T03:04:07.000Z');
  expect(input.requests).toHaveLength(2);
  expect(input.result.truth.completenessVerified).toBe(true);
  expect(issueAGradeOfficialTotalCertificate(input).status).toBe('CERTIFIED');
});
it.each(['date','url','cities','company','missing','extra','identity','status','location'])('rejects %s detail/output drift in the real A generator',async(kind)=>{
  const input=await candidate();
  if(kind==='date')input.jobs[0]!.officialPublishedAt='2026-10-02T00:00:00.000Z';
  if(kind==='url')input.jobs[0]!.officialUrl='https://example.org/wrong-job';
  if(kind==='cities')input.jobs[0]!.cities=['北京'];
  if(kind==='company')input.jobs[0]!.officialChineseCompanyName='错误公司';
  if(kind==='missing')input.evidence.artifacts.pop();
  if(kind==='extra')input.evidence.artifacts.push({...input.evidence.artifacts[0]!,id:'extra',logicalKey:'extra'});
  if(['identity','status','location'].includes(kind)){
    const detail=input.evidence.artifacts[1];if(!detail)throw Error('Expected captured native detail');
    const body=JSON.parse(detail.body as string);if(kind==='identity')body.Data.Id='00000000-0000-4000-8000-000000000001';if(kind==='status')body.Data.Status=2;if(kind==='location')body.Data.LocNames=['北京市'];detail.body=JSON.stringify(body);
  }
  expect(issueAGradeOfficialTotalCertificate(input).status).toBe('REJECTED');
});
it('retains unknown or conflicting date originals without inventing a timestamp',async()=>{
  const input=await candidate(undefined,{...row,PostDateInt:0});
  expect(input.jobs).toHaveLength(1);expect(input.jobs[0]!.officialPublishedAt).toBeUndefined();
  expect(input.result.truth.completenessVerified).toBe(true);
});

it('preserves the native epoch precision while retaining sub-millisecond raw dates',()=>{
  expect(beisenNativePublishedAt({PostDate:'2026-06-25T16:15:15.7381356',PostDateInt:1782375315738})).toBe('2026-06-25T08:15:15.738Z');
  expect(beisenNativePublishedAt({PostDate:'2026-02-30T16:15:15',PostDateInt:1772439315000})).toBeUndefined();
});
it('rejects a truncated native universe even when metadata and page hashes are internally consistent',async()=>{
  const input=await candidate();
  const artifact=input.evidence.artifacts[0]!,body=JSON.parse(artifact.body as string);body.Count=615;artifact.body=JSON.stringify(body);
  input.officialArtifactSha256=createHash('sha256').update(artifact.body).digest('hex');
  input.evidence.pages[0]!.responseFingerprintSha256=input.officialArtifactSha256;
  const {evaluatePaginationEvidence,deriveCanonicalPaginationEvidence}=await import('../../src/crawler/paginationEvidence');
  input.evidence=deriveCanonicalPaginationEvidence({evidence:input.evidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true});
  input.paginationEvaluation=evaluatePaginationEvidence({evidence:input.evidence,expectedChannelIds:[],filteredOutput:true,allowMissingReturnedPage:true,allowPositiveOfficialTotalCountAfterAdapterReconciliation:true});
  expect(issueAGradeOfficialTotalCertificate(input).status).toBe('REJECTED');
});

it('stops a stalled native detail body on source cancellation and retains the list',async()=>{
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-shanghai-pharma-social')!,stop=new AbortController();
  let stream:ReadableStreamDefaultController<Uint8Array>|undefined;
  vi.stubGlobal('fetch',async(input:unknown)=>{
    const url=String(input),detail=url.includes('GetJobAdInfo');
    const response=new Response(detail?new ReadableStream<Uint8Array>({start(c){stream=c;setTimeout(()=>stop.abort(),5);}}):JSON.stringify({Code:200,Count:1,Data:[row]}),{headers:{'content-type':'application/json'}});
    Object.defineProperty(response,'url',{value:url});return response;
  });
  const capture=runWithOfficialSourceCancellation(stop.signal,()=>runSourceCrawl(plan,{fetch:createOfficialJsonSourceFetch({allowBrowserFallback:false}),isBaseline:false}));
  const result=await Promise.race([capture,new Promise<null>(resolve=>setTimeout(()=>resolve(null),80))]);
  try{stream?.close();}catch{}await capture.catch(()=>undefined);
  expect(result).not.toBeNull();expect(result?.jobs).toHaveLength(1);expect(result?.truth.completenessVerified).toBe(false);
});
it('refuses an oversized native detail body while preserving its original list row',async()=>{
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-shanghai-pharma-social')!;
  vi.stubGlobal('fetch',async(input:unknown)=>{
    const url=String(input),detail=url.includes('GetJobAdInfo');
    const response=new Response(detail?'x'.repeat(256*1024+1):JSON.stringify({Code:200,Count:1,Data:[row]}),{headers:{'content-type':'application/json'}});
    Object.defineProperty(response,'url',{value:url});return response;
  });
  const result=await runSourceCrawl(plan,{fetch:createOfficialJsonSourceFetch({allowBrowserFallback:false}),isBaseline:false});
  expect(result.jobs).toHaveLength(1);expect(result.truth.completenessVerified).toBe(false);expect(result.fetchEvidence?.artifacts).toHaveLength(1);
});

it('reserves cleanup from the whole acquisition start even when listing consumes the soft deadline',async()=>{
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-shanghai-pharma-social')!;
  let now=new Date(NOW),requests=0;
  const fetched=await createOfficialJsonSourceFetch({now:()=>now,http:async request=>{
    requests++;now=new Date(Date.parse(NOW)+18*60_000);
    return {status:200,finalUrl:request.url,contentType:'application/json',capturedAt:now.toISOString(),body:JSON.stringify({Code:200,Count:1,Data:[row]})};
  }})(plan);
  const result=await runSourceCrawl(plan,{fetch:async()=>fetched,isBaseline:false});
  expect(requests).toBe(1);expect(result.jobs).toHaveLength(1);expect(result.fetchEvidence?.artifacts).toHaveLength(1);expect(result.truth.completenessVerified).toBe(false);
});
