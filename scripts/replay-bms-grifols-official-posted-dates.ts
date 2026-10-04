/** Offline diagnostic only. No archive import, owned acquisition, admission, or network access. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { createGrifolsChinaSourceFetch } from "../src/crawler/grifolsChinaSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../src/crawler/runSourceCrawl";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl } from "../src/crawler/sourceFetchEvidence";
import { getSourceQualityPolicy } from "../src/crawler/sourceQualityAdmission";

const [root, factsPath] = process.argv.slice(2);
if (!root || !factsPath) throw new Error("Usage: node --import tsx scripts/replay-bms-grifols-official-posted-dates.ts <retained-source-parent> <retained-date-facts.json>");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const factsBytes = await readFile(factsPath);
assert.equal(hash(factsBytes), "fe220d65abe495ed7af390e74cb339f290ef3cfdfd24664a951a1c61d502e81e", "Unexpected date inventory");
const inventory = JSON.parse(factsBytes.toString("utf8")) as { sources: Array<{
  sourceId:string; observationCapturedAt:string; evidenceFileSha256:string; outputCount:number; earliestUtc:string; latestUtc:string;
  artifacts:Array<{logicalKey:string;sha256:string}>;
  rows:Array<{officialId:string;utcIso:string}>;
}> };
const reports = [];
for (const sourceId of ["source-bms-china-social", "source-grifols-china-social"]) {
  const facts = inventory.sources.find(source => source.sourceId === sourceId)!;
  const directory = join(root, sourceId);
  const bytes = await readFile(join(directory, "evidence.private.json"));
  assert.equal(hash(bytes), facts.evidenceFileSha256, "Unexpected retained evidence");
  const evidence = parsePersistentSourceFetchEvidence(JSON.parse(bytes.toString("utf8")));
  const previous = JSON.parse(await readFile(join(directory, "candidates.private.json"), "utf8"));
  const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8"));
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
  assert(plan?.adapterId === "official-json");
  assert.equal(evidence.artifacts.length, facts.artifacts.length);
  evidence.artifacts.forEach((artifact,index) => {
    assert.equal(artifact.logicalKey,facts.artifacts[index]!.logicalKey);
    assert.equal(hash(artifact.body),facts.artifacts[index]!.sha256);
  });
  const capturedAt = facts.observationCapturedAt;
  assert(previous.records.every((job: {evidence:{capturedAt:string}}) => job.evidence.capturedAt === capturedAt));
  assert(Date.parse(capturedAt) >= Date.parse(summary.startedAt));
  let cursor = 0, observedAt = capturedAt;
  // Every injected response is a retained artifact; an unexpected request throws with no fallback.
  const http = async (request: {url:string;method:string}) => {
    const artifact = evidence.artifacts[cursor];
    assert(artifact,"Unexpected request: offline replay has no network fallback");
    assert.equal(request.method,"GET");
    assert.equal(sanitizeEvidenceHttpUrl(request.url),artifact.requestedUrl);
    assert.equal(sanitizeEvidenceHttpUrl(request.url),artifact.finalUrl);
    cursor++;
    observedAt = artifact.capturedAt;
    return {status:artifact.httpStatus!,body:typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8"),
      finalUrl:request.url,contentType:artifact.contentType!,capturedAt:artifact.capturedAt};
  };
  const fetched = await (sourceId === "source-bms-china-social"
    ? createOfficialJsonSourceFetch({allowBrowserFallback:false,now:()=>new Date(observedAt),http})
    : createGrifolsChinaSourceFetch({now:()=>new Date(observedAt),http}))(plan);
  assert(fetched.ok,fetched.ok ? "" : fetched.failureReason);
  assert.equal(cursor,evidence.artifacts.length);
  const result = await runSourceCrawl(plan,{fetch:async()=>fetched});
  assert(result.truth.completenessVerified,"New strict replay did not verify");
  assert(result.reconciliation && fetched.paginationEvaluation);
  assert(replayStrictSourceQualityEvidence({plan,evidence,paginationEvaluation:fetched.paginationEvaluation,
    reconciliation:result.reconciliation,jobs:result.jobs,capturedAt}),"Original retained evidence did not replay");
  assert.deepEqual(fetched.fetchEvidence?.fetchCounts,summary.fetchCounts);
  assert.deepEqual(fetched.fetchEvidence?.fetchLosses,[]);
  const expectedBmsCities: Record<string,string> = {"Field - China":"中国","Field - China - CN":"中国","Xi'an - CN":"西安","Chongqing - CN":"重庆","Zhengzhou - CN":"郑州","Shijiazhuang - CN":"石家庄","Tianjin - CN":"天津","Nanjing - CN":"南京","Qingdao - CN":"青岛","Hangzhou - CN":"杭州","Shanghai - CN":"上海"};
  const expectedPrevious = previous.records.map((job: {cities:string[];locationRaw:string}) => sourceId === "source-grifols-china-social"
    ? {...job,cities:job.cities.map(city=>city==="Shanghai"?"上海":city==="China"?"全国":city)} : {...job,cities:[expectedBmsCities[job.locationRaw]]});
  assert.deepEqual(result.jobs.map(({officialPublishedAt,...job})=>job),expectedPrevious);
  assert.equal(result.jobs.length,facts.outputCount);
  const expectedDates = new Map(facts.rows.map(row => [sourceId === "source-bms-china-social"
    ? `official-json:sha256:${hash(JSON.stringify(row.officialId))}` : row.officialId, new Date(row.utcIso).toISOString()]));
  assert.equal(expectedDates.size,result.jobs.length);
  result.jobs.forEach(job=>assert.equal(job.officialPublishedAt,expectedDates.get(job.sourceJobId!)));
  assert.equal(getSourceQualityPolicy(plan),"PLAN_BOUND_SOURCE_QUALITY_V1");
  reports.push({sourceId,originalCapturedAt:capturedAt,previousConfigSha256:summary.sourcePlanSha256,
    configSha256:sourcePlanConfigSha256(plan),fetchCounts:fetched.fetchEvidence?.fetchCounts,fetchLossCount:0,
    outputCount:result.jobs.length,earliestUtc:new Date(facts.earliestUtc).toISOString(),latestUtc:new Date(facts.latestUtc).toISOString(),
    previousFieldsUnchangedExceptReviewedCityLabels:true,cityLabels:result.jobs.map(job=>({sourceJobId:job.sourceJobId,cities:job.cities})),publicationRegistered:getSourceQualityPolicy(plan)!==null,originalEvidenceReplay:true});
}
console.log(JSON.stringify({classification:"OFFLINE_BMS_GRIFOLS_DATE_PRESERVATION_REPLAY",networkUsed:false,databaseWrites:false,
  temporalWindowSelected:false,
  transportMetadata:"EXACT_PLAN_REQUEST_WITH_SANITIZED_RETAINED_URL_MATCH",sources:reports},null,2));
