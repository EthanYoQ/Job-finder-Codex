import { describe, expect, it } from "vitest";
import { selectStrictFullReleaseReadiness } from "../../src/readiness/strictPersistedReadiness";
import { createHash } from "node:crypto";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";

const h = "a".repeat(64);
const identity = { releaseCandidateId: "rc-1", commitSha: h, rosterSha256: h,
  sourcePlanSha256: h, sourceConfigSha256: h, adapterBundleSha256: h,
  sourceTreeSha256:h,runtimeTreeSha256:h,
  plannedSourceIds: ["source-1"], plannedSourceSetSha256: createHash("sha256").update('["source-1"]').digest("hex"),
  companyAudits:[{companyId:"company-1",category:"FOREIGN_PHARMA" as const,status:"HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const}],
  releaseMembers:[{companyId:"company-1",sourceId:"source-1",surfaceId:"surface-1",channelId:"channel-1",category:"FOREIGN_PHARMA" as const}],
  currentTime: new Date("2026-07-10T02:00:00Z"), freshnessMaximum: 3_600_001 };
const tuple={releaseCandidateId:"rc-1",batchId:"batch-1",sourceResultId:"result-1",sourceId:"source-1"};
const lifecycleSetEvidence={...tuple,currentKeys:["current"],currentSha256:canonicalStringSetSha256(["current"]),graceEntries:[],graceSha256:canonicalStringSetSha256([]),visibleKeys:["current"],visibleSha256:canonicalStringSetSha256(["current"]),lifecycleEntries:[{...tuple,key:"current",status:"ACTIVE" as const,missingSuccessfulCrawlCount:0}]};
const source = { id: "result-1", sourceId: "source-1", atomicCommitState: "COMMITTED" as const,
  transportState: "SUCCEEDED" as const, adapterState: "SUCCEEDED" as const,
  completenessState: "VERIFIED" as const, sourceConfigHash: h, adapterVersion: h,
  canonicalOutputSetSha256: lifecycleSetEvidence.currentSha256, canonicalCurrentJobSetSha256: lifecycleSetEvidence.currentSha256,
  canonicalGraceJobSetSha256: lifecycleSetEvidence.graceSha256, canonicalVisibleJobSetSha256: lifecycleSetEvidence.visibleSha256,
  officialEvidenceArtifactId: "artifact-1", artifactRedactionCommitmentSha256: h,lifecycleSetEvidence };
const batch = { id: "batch-1", ...identity, kind: "FULL_RELEASE" as const,
  status: "SUCCESS" as const, startedAt:new Date("2026-07-10T00:50:00Z"),finishedAt: new Date("2026-07-10T01:00:00Z"),
  plannedSourceCount: 1, aggregateJobSetSha256: h, sourceResults: [source] };
function batchCopy(id:string,finishedAt:Date){const resultId=`result-${id}`;return {...batch,id,startedAt:new Date(finishedAt.getTime()-60_000),finishedAt,sourceResults:[{...source,id:resultId,lifecycleSetEvidence:{...source.lifecycleSetEvidence,batchId:id,sourceResultId:resultId,lifecycleEntries:source.lifecycleSetEvidence.lifecycleEntries.map(entry=>({...entry,batchId:id,sourceResultId:resultId}))}}]};}

describe("strict persisted readiness selector", () => {
  it("selects the latest two independently complete, fresh, ordered exact batches", () => {
    const latest = batchCopy("batch-2",new Date("2026-07-10T01:30:00Z"));
    expect(selectStrictFullReleaseReadiness([batch, latest], { ...identity,
      sourceConfigHashes: { "source-1": h }, adapterVersions: { "source-1": h } })).toEqual([latest, batch]);
  });
  it("selects the newest two successes and ignores an older success",()=>{
    const second=batchCopy("batch-2",new Date("2026-07-10T01:20:00Z"));
    const latest=batchCopy("batch-3",new Date("2026-07-10T01:30:00Z"));
    expect(selectStrictFullReleaseReadiness([batch,second,latest],{...identity,sourceConfigHashes:{"source-1":h},adapterVersions:{"source-1":h}})).toEqual([latest,second]);
  });

  it("blocks when a newer exact-identity batch is failed or pending",()=>{
    const latest=batchCopy("batch-2",new Date("2026-07-10T01:30:00Z"));
    const failed={...batchCopy("batch-3",new Date("2026-07-10T01:40:00Z")),status:"FAILED"};
    expect(()=>selectStrictFullReleaseReadiness([batch,latest,failed],{...identity,sourceConfigHashes:{"source-1":h},adapterVersions:{"source-1":h}})).toThrow(/newer.*failed|pending|unreconciled/i);
  });
  it.each(["FAILED","PENDING"])("blocks a newer %s batch with no finishedAt",status=>{
    const second=batchCopy("batch-2",new Date("2026-07-10T01:30:00Z"));
    const unreconciled={...batchCopy("batch-3",new Date("2026-07-10T01:40:00Z")),status,finishedAt:null,startedAt:new Date("2026-07-10T01:39:00Z")};
    expect(()=>selectStrictFullReleaseReadiness([batch,second,unreconciled],{...identity,sourceConfigHashes:{"source-1":h},adapterVersions:{"source-1":h}})).toThrow(/newer.*failed|pending|unreconciled/i);
  });

  it("rejects stitching when either selected batch lacks independent evidence", () => {
    const brokenBase=batchCopy("batch-2",new Date("2026-07-10T01:30:00Z"));
    const broken={...brokenBase,sourceResults:[{...brokenBase.sourceResults[0]!,officialEvidenceArtifactId:null}]};
    expect(() => selectStrictFullReleaseReadiness([batch, broken], { ...identity, sourceConfigHashes: { "source-1": h },
      adapterVersions: { "source-1": h } })).toThrow(/evidence/i);
  });

  it("rejects a canonical output commitment that differs from the reconciled current set in either selected batch",()=>{
    const latest=batchCopy("batch-2",new Date("2026-07-10T01:30:00Z"));
    const broken={...latest,sourceResults:[{...latest.sourceResults[0]!,canonicalOutputSetSha256:h}]};
    expect(()=>selectStrictFullReleaseReadiness([batch,broken],{...identity,sourceConfigHashes:{"source-1":h},adapterVersions:{"source-1":h}})).toThrow(/hash mismatch/i);
  });

  it("rejects stale, exact-boundary, future, and ambiguously ordered batches", () => {
    const expectation = { ...identity, currentTime: new Date("2026-07-10T02:00:00Z"), freshnessMaximum: 3_600_000,
      sourceConfigHashes: { "source-1": h }, adapterVersions: { "source-1": h } };
    const fresh = batchCopy("fresh",new Date("2026-07-10T01:30:00Z"));
    expect(() => selectStrictFullReleaseReadiness([batch, fresh], expectation)).toThrow(/fresh/i);
    expect(() => selectStrictFullReleaseReadiness([fresh,batchCopy("future",new Date("2026-07-10T02:00:01Z"))], expectation)).toThrow(/fresh/i);
    expect(() => selectStrictFullReleaseReadiness([fresh, { ...fresh, id: "same-time" }], expectation)).toThrow(/ordered/i);
  });
});
