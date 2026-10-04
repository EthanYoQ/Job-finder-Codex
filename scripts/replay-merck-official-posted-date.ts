import { persistentOfficialJsonJobId } from "../src/crawler/officialJsonEvidence";
import { merckOfficialCities, merckOfficialPostedDate } from "../src/crawler/merckChinaQuality";
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
if (!directory) throw new Error("Usage: node --import tsx scripts/replay-merck-official-posted-date.ts <retained Merck directory>");
const evidenceBytes = await readFile(join(directory, "evidence.private.json"));
assert.equal(createHash("sha256").update(evidenceBytes).digest("hex"),
  "3925b901e9caaf2d5a37c81455b52efe500573aa1476c16e3e2ed2e21bc54923", "Unexpected retained evidence");
const evidence = parsePersistentSourceFetchEvidence(JSON.parse(evidenceBytes.toString("utf8")));
const previous = JSON.parse(await readFile(join(directory, "candidates.private.json"), "utf8"));
const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-merck-china-social");
assert(plan?.adapterId === "official-json");
const expectedBodies = [
  "2e43a0330841649e4b314cf05e5634f021a7c9144991017392d2ac48b63b44c7",
  "0d4d95abedc37fbc0a8a5d52feb7a484fecd16b97de35c5fa25aba18899e676e",
  "e7c2eca166859bc037d25862aa6cdb28048cb01643014dc86d00dcb13b73fac1"
];
assert.equal(evidence.artifacts.length, 3);
evidence.artifacts.forEach((artifact, index) => assert.equal(
  createHash("sha256").update(artifact.body).digest("hex"), expectedBodies[index]));
let cursor = 0;
let observedAt = summary.startedAt as string;
// Every request consumes exact retained bytes or throws; there is no transport fallback.
const fetched = await createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>new Date(observedAt),http:async request=>{
  const artifact = evidence.artifacts[cursor];
  assert(artifact, "Unexpected request: offline replay has no network fallback");
  assert.equal(request.method, cursor === 0 ? "GET" : "POST");
  assert.equal(request.url, cursor === 0 ? plan.source.officialEntryUrl : "https://careers.emdgroup.com/widgets");
  assert.equal(safeOfficialJsonEvidenceUrl(request.url), artifact.requestedUrl);
  assert.equal(safeOfficialJsonEvidenceUrl(request.url), artifact.finalUrl);
  cursor++;
  observedAt = artifact.capturedAt;
  return {status:artifact.httpStatus!,body:typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8"),
    // Retained evidence strips query strings; reconstruct only the exact plan-bound request URL.
    finalUrl:request.url,contentType:artifact.contentType!,capturedAt:artifact.capturedAt};
}})(plan);
assert(fetched.ok, fetched.ok ? "" : fetched.failureReason);
assert.equal(cursor, 3);
const result = await runSourceCrawl(plan,{fetch:async()=>fetched});
assert(result.truth.completenessVerified, "Strict raw evidence replay did not verify");
assert(result.reconciliation && fetched.paginationEvaluation);
assert(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:fetched.paginationEvaluation,
  reconciliation:result.reconciliation,jobs:result.jobs,capturedAt:summary.startedAt}), "Original retained evidence did not replay");
assert.deepEqual(fetched.fetchEvidence?.fetchCounts, summary.fetchCounts);
const oldById = new Map(previous.records.map((job: {sourceJobId:string}) => [job.sourceJobId, job]));
const rawRows = evidence.artifacts.slice(1).flatMap(artifact => JSON.parse(artifact.body as string).refineSearch.data.jobs);
const rawById = new Map(rawRows.map((row: {jobSeqNo:string}) => [persistentOfficialJsonJobId(row.jobSeqNo), row]));
const cityCorrections: object[] = [];
for (const {officialPublishedAt, cities, ...job} of result.jobs) {
  const old = oldById.get(job.sourceJobId!) as Record<string, unknown>;
  const {cities: previousCities, ...previousFields} = old;
  assert.deepEqual(job, previousFields);
  const raw = rawById.get(job.sourceJobId!) as Record<string, unknown>;
  assert.equal(officialPublishedAt, merckOfficialPostedDate(raw.postedDate));
  assert.deepEqual(cities, merckOfficialCities(raw));
  if (JSON.stringify(cities) !== JSON.stringify(previousCities)) cityCorrections.push({locationRaw:job.locationRaw,previousCities,cities});
}
assert.equal(result.jobs.length, 55);
assert.equal(cityCorrections.length, 11);
const pendingCityCount = result.jobs.filter(job => JSON.stringify(job.cities) === JSON.stringify(["城市待核"])).length;
assert.equal(pendingCityCount, 7);
const dates = result.jobs.map(job => job.officialPublishedAt!).sort();
console.log(JSON.stringify({classification:"OFFLINE_MERCK_DATE_GEOGRAPHY_REPLAY",networkUsed:false,databaseWrites:false,
  productionRegistrationComplete:false,codePolicyRegistered:getSourceQualityPolicy(plan)!==null,temporalWindowSelected:false,
  transportMetadata:"PLAN_BOUND_URL_RECONSTRUCTION_FROM_SANITIZED_RETAINED_URLS",originalCapturedAt:summary.startedAt,
  previousConfigSha256:summary.sourcePlanSha256,configSha256:sourcePlanConfigSha256(plan),
  fetchCounts:fetched.fetchEvidence?.fetchCounts,fetchLossCount:fetched.fetchEvidence?.fetchLosses.length,
  outputCount:result.jobs.length,otherPreviousFieldsUnchanged:true,originalEvidenceReplay:true,
  preservedOfficialDateCount:dates.length,pendingCityCount,knownCityCount:result.jobs.length-pendingCityCount,earliestOfficialPublishedAt:dates[0],latestOfficialPublishedAt:dates.at(-1),cityCorrections},null,2));
