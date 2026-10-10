import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOwnedSourceQualityFetch, getSourceQualityPolicy, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { searchPortableSnapshot } from "../../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../../src/db/portablePublicSnapshotRepository";

const NOW=new Date("2026-10-02T00:00:00.000Z"),dirs:string[]=[];
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const sourcePlan=()=>getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),"source-bms-china-social")!;
function rows(){return [["Field - China","CN"],["Field - China - CN","CN"],["Shanghai - CN","Shanghai, Shanghai, CN"]].map(([location,standardized],i)=>({id:String(i+1),name:`Role ${i+1}`,positionUrl:`/careers/job/${i+1}`,postedTs:1790208000,locations:[location],standardizedLocations:[standardized],workLocationOption:"onsite",locationFlexibility:null}));}
async function capture(mutation:Record<string,unknown>={}){
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(NOW);
 const plan=sourcePlan(),positions=rows();Object.assign(positions[0]!,mutation);
 let calls=0;
 vi.stubGlobal("fetch",async(input:string)=>{calls++;expect(calls).toBe(1);expect(input).toBe("https://jobs.bms.com/api/pcsx/search?domain=bms.com&query=&location=china&start=0&sort_by=distance");return {status:200,url:String(input),headers:new Headers({"content-type":"application/json"}),text:async()=>JSON.stringify({status:200,data:{count:positions.length,positions}})};});
 const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
 const workspaceRoot=await mkdtemp(join(tmpdir(),"bms-geo-admission-"));dirs.push(workspaceRoot);
 const identity={releaseCandidateId:"bms-geo-test",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"offline-test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const batchId="bms-geo-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,NOW).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion},evidenceSubdirectory="quality/runtime-evidence";
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 return {plan,result,binding,identity,pending,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}};
}
describe("BMS reviewed mainland geography admission",()=>{
 it("registers only the exact location-pair configuration",()=>{const p=structuredClone(sourcePlan());expect(getSourceQualityPolicy(p)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");if(p.adapterId!=="official-json"||p.officialJsonFetch?.kind!=="eightfold-pcsx")throw Error("BMS plan");delete p.officialJsonFetch.cityScopePolicy;expect(getSourceQualityPolicy(p)).toBeNull();});
 it("issues an archive-bound receipt and preserves country-only rows without city matches",async()=>{
  const input=await capture(),admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("ACCEPTED");
  const jobCommands=buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands;
  expect(jobCommands).toHaveLength(3);expect(Object.fromEntries(jobCommands.map(c=>[c.record.locationRaw,c.record.cities]))).toEqual({"Field - China":["中国"],"Field - China - CN":["中国"],"Shanghai - CN":["上海"]});expect(jobCommands.every(c=>c.record.officialPublishedAt==="2026-09-24T00:00:00.000Z")).toBe(true);
  const commit=buildAtomicRuntimeCommit({...input,batchId:input.binding.batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:input.archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
  await expect(verifyAtomicRuntimeCommitForPersistence(commit)).resolves.toBeUndefined();
  const jobs=jobCommands.map(c=>({...c.record,id:c.record.sourceJobId!,city:c.record.cities[0]!,title:c.record.officialTitle,isNew:false}));
  const snapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:40,excludedCompanyCount:1},companies:[{id:input.plan.company.id,companyName:input.plan.company.officialChineseName,pinyin:"bms",required:true,publishingSourceIds:[input.plan.source.id],health:"HEALTHY",jobs}]} as unknown as PortablePublicSnapshot;
  expect(searchPortableSnapshot({city:"上海"},snapshot).totalJobs).toBe(1);for(const city of ["北京","广州"])expect(searchPortableSnapshot({city},snapshot).totalJobs).toBe(0);expect(jobs).toHaveLength(3);
 });
 it.each([{standardizedLocations:["US"]},{city:"Beijing"},{locations:["Field - China - HK"]},{standardizedLocations:["CN","US"]}])("rejects owned raw geography %j with no publication commands",async mutation=>{const input=await capture(mutation),admission=await issueSourceQualityAdmission(input);expect(admission.status).toBe("REJECTED");expect(buildSourceQualityJobCommands({...input,admission,previousJobs:[],firstAcceptedCurrentPolicyReceipt:null,baselineCompletedBeforeCrawl:true}).jobCommands).toEqual([]);});
 it("rejects imported evidence and a forged nationwide output",async()=>{const input=await capture();expect(await issueSourceQualityAdmission({...input,result:structuredClone(input.result)})).toMatchObject({status:"REJECTED",codes:["OWNED_ACQUISITION_REQUIRED"]});input.result.jobs[0]!.cities=["全国"];expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");});
});
