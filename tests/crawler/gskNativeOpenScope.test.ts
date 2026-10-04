import { createCipheriv, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { createMokaSourceFetch, decryptMokaResponse, type MokaHttpRequest } from '../../src/crawler/mokaSourceFetch';
import { runSourceCrawl } from '../../src/crawler/runSourceCrawl';
import { issueAGradeOfficialTotalCertificate } from '../../src/crawler/completenessCertificate';
const now='2026-10-02T15:00:00.000Z', iv='de7c21ed8d6f50fe', key='6e9ecb8e9c6c1a5e';
function plan(){return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),'source-gsk-china-social')!;}
function encrypted(value:unknown){const cipher=createCipheriv('aes-128-cbc',Buffer.from(key),Buffer.from(iv));return JSON.stringify({necromancer:key,data:cipher.update(JSON.stringify(value),'utf8','base64')+cipher.final('base64')});}
async function crawl(input:{pausedRow?:boolean;missingDefinition?:boolean}={}){
 const p=plan();const requests:MokaHttpRequest[]=[];
 const init={org:{id:'gsk'},siteId:'148067',mode:'social',aesIv:iv,jobCustomFields:input.missingDefinition?[]:[{id:273744,name:'Req status',type:'select_info',detail:['Open','Frozen','Filled','Close']}]};
 const fetch=createMokaSourceFetch({now:()=>new Date(now),http:async request=>{
  requests.push(request);
  let body:string;
  if(request.method==='GET')body=`<input id="init-data" value="${JSON.stringify(init).replaceAll('"','&quot;')}">`;
  else { const req=request.body as Record<string,unknown>;const offset=Number(req.offset),count=Math.min(50,65-offset);
   expect(req.customFields).toEqual({'273744':{values:['Open']}});
   body=encrypted({success:true,data:{jobStats:{total:65},offset,jobs:Array.from({length:count},(_,i)=>({id:`gsk-open-${offset+i}`,title:`Role ${offset+i}`,publishedAt:'2026-09-30T14:12:03',status:input.pausedRow&&i===0?'pause':'open',locations:[{country:'中国',cityName:'上海市'}]}))}});
  }
  return {status:200,body,finalUrl:request.url.replace(/#.*$/,''),contentType:request.method==='GET'?'text/html':'application/json',capturedAt:now};
 }});
 const result=await runSourceCrawl(p,{fetch});
 return {p,result,requests};
}
function certify(p:ReturnType<typeof plan>,result:Awaited<ReturnType<typeof crawl>>['result']){
 const evidence=result.fetchEvidence!;const official=evidence.artifacts.find(a=>a.logicalKey===evidence.declaredCompleteness?.artifactLogicalKey)!;
 return issueAGradeOfficialTotalCertificate({binding:{releaseCandidateId:'unit',batchId:'unit',sourceResultId:'unit',sourceConfigSha256:sourcePlanConfigSha256(p)},plan:p,transportSuccess:result.truth.transportSuccess,adapterSuccess:result.truth.adapterSuccess,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,officialArtifactSha256:createHash('sha256').update(official.body).digest('hex')});
}
describe('GSK native Open requisition scope',()=>{
 it('binds the registered Moka source and every request to the official Open filter, with all 65 and timezone-free source dates retained in evidence',async()=>{
  const {p,result,requests}=await crawl();
  expect(p.source.atsKind).toBe('MOKA');expect(result.truth.completenessVerified).toBe(true);
  expect(result.jobs).toHaveLength(65);
  expect(result.jobs.every(job=>job.officialPublishedAt===undefined)).toBe(true);
  const rawPage = decryptMokaResponse(JSON.parse(result.fetchEvidence!.artifacts.find(a=>a.logicalKey==='moka-page-0000')!.body), iv) as {data:{jobs:Array<{publishedAt:string}>}};
  expect(rawPage.data.jobs.every(job=>job.publishedAt==='2026-09-30T14:12:03')).toBe(true);expect(requests.filter(r=>r.method==='POST')).toHaveLength(2);
  expect(result.fetchEvidence?.fetchCounts).toMatchObject({rawCount:65,validCount:65,parseDiscardCount:0,validationDiscardCount:0});
  expect(certify(p,result), JSON.stringify(certify(p,result))).toMatchObject({status:'CERTIFIED',certificate:{counts:{officialTotal:65,finalUniqueJobCount:65}}});
 });
 it('rejects a frozen/paused record instead of silently discarding it',async()=>{const {result}=await crawl({pausedRow:true});expect(result.truth.completenessVerified).toBe(false);});
 it('rejects a bootstrap that no longer defines the official Req status field',async()=>{const {result}=await crawl({missingDefinition:true});expect(result.truth.completenessVerified).toBe(false);});
 it('rejects replay after the source policy is removed',async()=>{const {p,result}=await crawl();const changed=structuredClone(p);if(changed.adapterId==='official-json')delete changed.moka!.requisitionStatusPolicy;expect(certify(changed,result)).toMatchObject({status:'REJECTED'});});
});
