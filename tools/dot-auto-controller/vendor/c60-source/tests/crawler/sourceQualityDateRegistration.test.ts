import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { searchPortableSnapshot } from "../../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../../src/db/portablePublicSnapshotRepository";

const NOW = new Date("2026-10-01T10:12:00.000Z");
const dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const plan=(source:string)=>getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),`source-${source}-china-social`)!;
const url="https://jobsearch.grifols.com/job/Home-Office-Senior-MSL/1441789833/";
async function capture(source:"ucb"|"grifols",mutation:"missing-date"|"ambiguous-scope"|undefined=undefined,ucbRaw:Record<string,unknown>={}){
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(NOW);
 const p=plan(source);let requestCount=0;
 vi.stubGlobal("fetch",async(request:string,init:RequestInit)=>{
  requestCount++;let body:string;
  if(source==="ucb")body=init.method==="POST"?JSON.stringify({refineSearch:{totalHits:1,data:{jobs:[{jobSeqNo:"UCB1GLOBAL93941EXTERNALZHGLOBAL",jobId:"93941",reqId:"93941",title:"Scientific Search Evaluation",location:"Shanghai, Shanghai, China",city:"Shanghai",country:"China",...ucbRaw,...(mutation==="missing-date"?{}:{postedDate:"2026-08-24T05:54:14.000+0000"})}],aggregations:[]}}}):'<script>var phApp={"widgetApiEndpoint":"https://careers.ucb.com/widgets","country":"global","deviceType":"desktop","locale":"zh_global","refNum":"UCB1GLOBAL","pageName":"search-results","pageId":"page17"};</script>';
  else body=request===p.source.officialEntryUrl?`<span class="paginationLabel">Results 1 – 1 of 1</span><table id="searchresults" aria-label="Page 1 of 1"><tbody><tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="${url}">Senior MSL</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td><td class="colDate hidden-phone"><span class="jobDate">Sep 28, 2026</span></td></tr></tbody></table>`:`<link rel="canonical" href="${url}"><div class="jobDisplayShell"><meta itemprop="streetAddress" content="Home Office, CN">${mutation==="missing-date"?"":'<meta itemprop="datePosted" content="Mon Sep 28 00:00:00 UTC 2026">'}<div class="jobDisplay"><div class="content"><p><b>Location: ${mutation==="ambiguous-scope"?"APAC:China:Home Office":"Open to candidates across China, not limited to Shanghai."}</b></p></div></div></div>`;
  if(requestCount>2)throw Error("Unexpected fixture request");
  return {status:200,url:String(request),headers:new Headers({"content-type":source==="ucb"&&init.method==="POST"?"application/json":"text/html"}),text:async()=>body};
 });
 const result=await runSourceCrawl(p,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
 const workspaceRoot=await mkdtemp(join(tmpdir(),"date-admission-"));dirs.push(workspaceRoot);
 const binding={releaseCandidateId:"date-test",batchId:"date-batch",sourceResultId:`date-batch--${p.source.id}`,sourceConfigSha256:sourcePlanConfigSha256(p),adapterVersion:"a".repeat(64)};
 const evidenceSubdirectory="evidence";
 const archived=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:p.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:p.source.id,artifacts:result.fetchEvidence!.artifacts})});
 return {plan:p,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archived.artifacts}};
}
describe("reviewed dated-source portable admission",()=>{
 it.each(["ucb","grifols","organon"])("registers exact %s plans and refuses configuration drift",source=>{const p=structuredClone(plan(source));expect(getSourceQualityPolicy(p)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");p.source.officialEntryUrl+="&changed=1";expect(getSourceQualityPolicy(p)).toBeNull();});
 it.each(["ucb","grifols"] as const)("issues and publishes only the owned %s date-joined output",async source=>{
  const input=await capture(source);const decision=await issueSourceQualityAdmission(input);expect(decision.status).toBe("ACCEPTED");
  if(decision.status!=="ACCEPTED")throw Error(decision.codes.join(","));
  expect(decision.receipt.counts).toMatchObject({rawCount:1,parsedCount:1,validCount:1,finalUniqueJobCount:1,parseDiscardCount:0,validationDiscardCount:0,normalizationDiscardCount:0});
  expect(decision.receipt).not.toHaveProperty("grade");
  const output=buildSourceQualityJobCommands({...input,admission:decision,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:false});
  expect(output.jobCommands).toHaveLength(1);expect(output.jobCommands[0]!.record.officialPublishedAt).toBe(source==="ucb"?"2026-08-24T05:54:14.000Z":"2026-09-28T00:00:00.000Z");
  expect(input.result.jobs[0]!.cities).toEqual(source==="ucb"?["上海"]:["全国"]);
  const record=output.jobCommands[0]!.record;
  const snapshot={companies:[{id:record.companyId,pinyin:"company",companyName:record.officialChineseCompanyName,required:true,publishingSourceIds:[record.sourceId],jobs:[{...record,id:"j",city:record.cities[0],title:record.officialTitle,officialPublishedAt:record.officialPublishedAt,isNew:false}]}],coverage:{requiredCompanyCount:40,excludedCompanyCount:1},lastUpdatedAt:NOW.toISOString()} as unknown as PortablePublicSnapshot;
  expect(searchPortableSnapshot({city:"上海"},snapshot).totalJobs).toBe(1);
  expect(searchPortableSnapshot({city:"北京"},snapshot).totalJobs).toBe(source==="grifols"?1:0);
  expect(searchPortableSnapshot({city:"广州"},snapshot).totalJobs).toBe(source==="grifols"?1:0);
 });
 it.each(["ucb","grifols"] as const)("refuses a missing official date in %s without any job writes",async source=>{const input=await capture(source,"missing-date");const admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("REJECTED");expect(buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:false}).jobCommands).toEqual([]);});
 it("refuses generic China Home Office text rather than claiming nationwide",async()=>{const input=await capture("grifols","ambiguous-scope");expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");});
 it.each(["ucb","grifols"] as const)("rejects imported %s evidence and changed normalized dates",async source=>{const input=await capture(source);expect(await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});input.result.jobs[0]!.officialPublishedAt="2026-09-01T00:00:00.000Z";expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");});
});


describe("UCB primary locality agreement",()=>{
 it.each(["Beijing","NotShanghai","Shanghai Office","Beijing / Shanghai",null,42,""])("rejects contradictory or unknown raw city %j on the owned route",async city=>{
  const input=await capture("ucb",undefined,{city});const admission=await issueSourceQualityAdmission(input);
  expect(admission.status).toBe("REJECTED");
  expect(buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:false}).jobCommands).toEqual([]);
 });
 it.each(["Shanghai","shanghai","上海"])("accepts exact agreeing Shanghai alias %s",async city=>{
  const input=await capture("ucb",undefined,{city});expect((await issueSourceQualityAdmission(input)).status).toBe("ACCEPTED");expect(input.result.jobs[0]!.cities).toEqual(["上海"]);
 });
 it.each(["NotShanghai, Shanghai, China","Shanghai, Beijing, China","Shanghai, Atlantis, China"])("rejects conflicting or unreviewed primary locality %s",async location=>{
  const input=await capture("ucb",undefined,{location});expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
 });
});
