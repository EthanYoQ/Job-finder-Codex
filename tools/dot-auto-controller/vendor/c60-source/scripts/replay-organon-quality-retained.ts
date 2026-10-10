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
import { safeOfficialJsonEvidenceUrl, persistentOfficialJsonJobId } from "../src/crawler/officialJsonEvidence";
import { getSourceQualityPolicy } from "../src/crawler/sourceQualityAdmission";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node --import tsx scripts/replay-organon-quality-retained.ts <retained Organon directory>");
const evidenceBytes = await readFile(join(directory, "evidence.private.json"));
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"),
  "c433b8d5edc3f3b759c7f401ed60f15600942bedcead66287a8efd5f01676641", "Unexpected retained evidence");
const evidence = parsePersistentSourceFetchEvidence(JSON.parse(evidenceBytes.toString("utf8")));
const previous = JSON.parse(await readFile(join(directory, "candidates.private.json"), "utf8"));
const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-organon-china-social");
assert(plan?.adapterId === "official-json");
const expectedBodies = [
  "d654281d51e87e4adacabc787932f234d0acea4ef3839f57debcd6cdc8d9948e",
  "6ccca9033625a7218e97597c848650fd52cb7e7d5a9ecfae6044379302e2ba4d"
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
  if(cursor === 1){
    const body=JSON.parse(request.body!);
    assert.deepEqual(body.selected_fields,{country:["China"]});assert.equal(body.size,50);assert.equal(body.from,0);
    assert.equal(body.refNum,"MECEUS");assert.equal(body.locale,"zh_cn");assert.equal(body.pageId,"page18-ds");
  }
  assert.equal(request.url, cursor === 0 ? plan.source.officialEntryUrl : "https://jobs.organon.com/widgets");
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
assert.deepEqual(result.jobs.map(({cities,officialPublishedAt,...job})=>job), previous.records.map(({cities,...job}:Record<string,unknown>)=>job));
assert.equal(result.jobs.length, 4);
assert.equal(fetched.fetchEvidence?.fetchLosses.length, 0);
const expectedDates = new Map([
  ["MECEUSR541923ZHCN", "2026-09-24T00:00:00.000Z"],
  ["MECEUSR542425ZHCN", "2026-09-24T00:00:00.000Z"],
  ["MECEUSR542257ZHCN", "2026-09-14T00:00:00.000Z"],
  ["MECEUSR542267ZHCN", "2026-09-07T00:00:00.000Z"]
]);
const page = JSON.parse(evidence.artifacts[1]!.body as string).refineSearch;
assert.equal(Object.hasOwn(page, "from"), false);
assert.equal(fetched.fetchEvidence?.pages[0]?.requestedOffset, 0);
assert.equal(fetched.fetchEvidence?.pages[0]?.returnedOffset, null);
const dateRows = (page.data.jobs as Array<Record<string, unknown>>).map(raw => {
  const rawId = raw.jobSeqNo as string;
  const expected = expectedDates.get(rawId);
  assert(expected, "Unexpected raw ID");
  assert.equal(raw.postedDate, expected.replace("Z", "+0000"));
  const matches = result.jobs.filter(job => job.sourceJobId === persistentOfficialJsonJobId(rawId));
  assert.equal(matches.length, 1, "Each raw ID must join exactly one normalized record");
  assert.equal(matches[0]!.officialPublishedAt, expected);
  return { rawId, sourceJobId: matches[0]!.sourceJobId, rawPostedDate: raw.postedDate, officialPublishedAt: expected };
});
assert.equal(new Set(dateRows.map(row => row.rawId)).size, 4);
const conflict = (page.data.jobs as Array<Record<string, unknown>>).find(raw => raw.jobId === "R542267")!;
assert.equal(conflict.location, "Wenzhou, Zhejiang, China");
assert.equal(conflict.workLocation, "CHN - Chengdu");
assert.deepEqual(result.jobs.map(job=>job.cities),[["上海"],["上海"],["上海"],["城市待核"]]);
assert.equal(result.jobs.find(job=>job.sourceJobId===persistentOfficialJsonJobId("MECEUSR542267ZHCN"))!.locationRaw,"Wenzhou, Zhejiang, China");
console.log(JSON.stringify({classification:"OFFLINE_ORGANON_QUALITY_REPLAY",networkUsed:false,databaseWrites:false,
  publicationRegistered:getSourceQualityPolicy(plan)!==null,productionRegistrationComplete:false,temporalWindowSelected:false,
  transportMetadata:"PLAN_BOUND_URL_RECONSTRUCTION_FROM_SANITIZED_RETAINED_URLS",originalCapturedAt:summary.startedAt,
  previousConfigSha256:summary.sourcePlanSha256,configSha256:sourcePlanConfigSha256(plan),
  fetchCounts:fetched.fetchEvidence?.fetchCounts,fetchLossCount:fetched.fetchEvidence?.fetchLosses.length,
  outputCount:result.jobs.length,previousFieldsExceptCitiesAndDatesUnchanged:true,cityCounts:{上海:3,城市待核:1},originalEvidenceReplay:true,
  dateRows, earliestUtc:"2026-09-07T00:00:00.000Z",latestUtc:"2026-09-24T00:00:00.000Z",
  pagination:{rawFromPresent:false,requestedOffset:0,returnedOffset:null},
  cityConflict:"R542267: primary/nested/URL Wenzhou conflicts with workLocation/address Chengdu; city remains pending",
  productionEvidence:false},null,2));
