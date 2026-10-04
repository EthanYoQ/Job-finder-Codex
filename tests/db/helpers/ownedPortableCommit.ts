import { afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSourceEvidence } from "../../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch } from "../../../src/crawler/runtimeAtomicEvidence";
import { runSourceCrawl } from "../../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../../src/data/companyRegistry";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../../../src/crawler/sourceQualityAdmission";

const NOW = new Date();
const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(p => rm(p, {recursive:true, force:true}))); });
function plan() { return structuredClone(getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-hansoh-social")!); }
function row(index: number) { return {Id:`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`, JobAdId:index,
  JobAdName:`职位${index}`, LocNames:["上海市"], Category:"社会招聘", CategoryId:"1", Kind:"全职", Status:1,
  PostDate:new Date(NOW.getTime()-86400000).toISOString().replace("Z", ""), ChangeDate:"0001-01-01T00:00:00"}; }
async function capture(rows = [row(1)]) {
  vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const page = JSON.parse(String(init.body)).PageIndex;
    return {status:200, url:String(url), headers:new Headers({"content-type":"application/json"}),
      text: async () => JSON.stringify({Code:200, Count:rows.length, Data:rows.slice(page*100,(page+1)*100)})};
  }));
  const p = plan();
  const result = await runSourceCrawl(p, {fetch:createOwnedSourceQualityFetch(), isBaseline:false});
  const workspaceRoot = await mkdtemp(join(tmpdir(), "portable-source-quality-")); dirs.push(workspaceRoot);
  const binding = {releaseCandidateId:"portable-test", batchId:"batch-1", sourceResultId:"batch-1--source-hansoh-social",
    sourceConfigSha256:sourcePlanConfigSha256(p), adapterVersion:"a".repeat(64)};
  const evidenceSubdirectory = "portable-quality/runtime-evidence";
  const archive = await archiveSourceEvidence({workspaceRoot, ...binding, sourceId:p.source.id, evidenceSubdirectory,
    captureTool:result.fetchEvidence!.captureTool, artifacts:bindRuntimeEvidenceArtifactIds({...binding, sourceId:p.source.id,
      artifacts:result.fetchEvidence!.artifacts})});
  return {plan:p, result, binding, archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}};
}

export async function ownedPortableFixture(options: { title?: string; excluded?: boolean; transport?: boolean; rejected?: boolean } = {}) {
 const rows = [{ ...row(1), ...(options.title === undefined ? {} : { JobAdName:options.title }) }];
 if (options.excluded) rows.push({ ...row(2), LocNames:["美国"] });
 const input=await capture(rows);
 // Synthetic metadata exercises the persisted transport/ref mapping, not a
 // claim that the Hansoh acquisition used a live browser fallback.
 if (options.transport) input.result.priorTransportAttempts = [{ transport:"BROWSER_SESSION", outcome:"SUCCEEDED",
   code:"HCM_BROWSER_SUCCEEDED", capturedAt:NOW.toISOString() }];
 const identity={releaseCandidateId:input.binding.releaseCandidateId,commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"quality-worker",expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const pending=buildPendingRuntimeBatch(input.binding.batchId,[input.plan],identity,NOW).sources[0]!;input.binding.adapterVersion=pending.adapterVersion;
 const admission=await issueSourceQualityAdmission(input);if(admission.status!=="ACCEPTED" && !options.excluded)throw Error(JSON.stringify(admission));
 const args={plan:input.plan,pending,identity,batchId:input.binding.batchId,result:input.result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:input.archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1" as const,sourceQualityAdmission:options.rejected ? { status:"REJECTED" as const, codes:["SYNTHETIC_REJECTION"] } : admission,firstAcceptedCurrentPolicyReceipt:null};
 return {input,admission,args,pending,identity};
}
