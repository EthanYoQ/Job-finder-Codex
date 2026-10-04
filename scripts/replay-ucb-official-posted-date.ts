/** Offline diagnostic only. No archive import, owned acquisition, admission, or network access. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../src/crawler/runSourceCrawl";
import { parsePersistentSourceFetchEvidence } from "../src/crawler/sourceFetchEvidence";
import { safeOfficialJsonEvidenceUrl } from "../src/crawler/officialJsonEvidence";
import { getSourceQualityPolicy } from "../src/crawler/sourceQualityAdmission";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node --import tsx scripts/replay-ucb-official-posted-date.ts <retained UCB directory>");
const evidenceBytes = await readFile(join(directory, "evidence.private.json"));
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"),
  "6f73966ba714fb5a8bfa4c98584cdef037003ba9d2f1117ba679d33937765f37", "Unexpected retained evidence");
const evidence = parsePersistentSourceFetchEvidence(JSON.parse(evidenceBytes.toString("utf8")));
const previous = JSON.parse(await readFile(join(directory, "candidates.private.json"), "utf8"));
const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-ucb-china-social");
assert(plan?.adapterId === "official-json");
const expectedBodies = [
  "3f64e49176aed4d71cf809ba2b9ce007e09733ff56ee6ec6e56f50fca76ac75d",
  "e431aab7b3839b479b33a48d4aeffe35cc97fe83a16809fd4a795f3b89a3149c"
];
assert.equal(evidence.artifacts.length, 2);
evidence.artifacts.forEach((artifact, index) => assert.equal(
  createHash("sha256").update(artifact.body).digest("hex"), expectedBodies[index]));
let cursor = 0;
let observedAt = summary.startedAt as string;
// Every request consumes exact retained bytes or throws; there is no transport fallback.
const fetched = await createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>new Date(observedAt),http:async request=>{
  const artifact = evidence.artifacts[cursor];
  assert(artifact, "Unexpected request: offline replay has no network fallback");
  assert.equal(request.method, cursor === 0 ? "GET" : "POST");
  assert.equal(request.url, cursor === 0 ? plan.source.officialEntryUrl : "https://careers.ucb.com/widgets");
  assert.equal(safeOfficialJsonEvidenceUrl(request.url), artifact.requestedUrl);
  assert.equal(safeOfficialJsonEvidenceUrl(request.url), artifact.finalUrl);
  cursor++;
  observedAt = artifact.capturedAt;
  return {status:artifact.httpStatus!,body:typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8"),
    // Retained evidence strips query strings; reconstruct only the exact plan-bound request URL.
    finalUrl:request.url,contentType:artifact.contentType!,capturedAt:artifact.capturedAt};
}})(plan);
assert(fetched.ok, fetched.ok ? "" : fetched.failureReason);
assert.equal(cursor, 2);
const result = await runSourceCrawl(plan,{fetch:async()=>fetched});
assert(result.truth.completenessVerified, "Strict raw evidence replay did not verify");
assert(result.reconciliation && fetched.paginationEvaluation);
assert(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:fetched.paginationEvaluation,
  reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:summary.startedAt}), "Original retained evidence did not replay");
assert.deepEqual(fetched.fetchEvidence?.fetchCounts, summary.fetchCounts);
assert.deepEqual(result.jobs.map(({officialPublishedAt,...job})=>job), previous.records);
assert.equal(result.jobs.length, 1);
assert.equal(result.jobs[0]!.officialPublishedAt,"2026-08-24T05:54:14.000Z");
assert.equal(getSourceQualityPolicy(plan),"PLAN_BOUND_SOURCE_QUALITY_V1");
console.log(JSON.stringify({classification:"OFFLINE_UCB_DATE_PRESERVATION_REPLAY",networkUsed:false,databaseWrites:false,
  publicationRegistered:true,temporalWindowSelected:false,
  transportMetadata:"PLAN_BOUND_URL_RECONSTRUCTION_FROM_SANITIZED_RETAINED_URLS",originalCapturedAt:summary.startedAt,
  previousConfigSha256:summary.sourcePlanSha256,configSha256:sourcePlanConfigSha256(plan),
  fetchCounts:fetched.fetchEvidence?.fetchCounts,fetchLossCount:fetched.fetchEvidence?.fetchLosses.length,
  outputCount:result.jobs.length,previousFieldsUnchanged:true,originalEvidenceReplay:true,
  rawPostedDate:"2026-08-24T05:54:14.000+0000",officialPublishedAt:result.jobs[0]!.officialPublishedAt},null,2));
