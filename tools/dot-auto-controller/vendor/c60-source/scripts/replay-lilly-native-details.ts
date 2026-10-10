/** Offline verification of original Lilly list and native application responses. No network or DB. */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence, type SourceFetchResult } from "../src/crawler/runSourceCrawl";

const [directory] = process.argv.slice(2);
if (!directory) throw Error("Usage: replay-lilly-native-details.ts <original-capture-directory>");
const manifest = JSON.parse(await readFile(join(directory, "capture-manifest.private.json"), "utf8"));
const details = JSON.parse(await readFile(join(directory, "detail-checks.private.json"), "utf8")).checks;
const expected = JSON.parse(await readFile(join(directory, "native-location-overrides.json"), "utf8")).jobs;
const captures = [...manifest.captures];
for (const detail of details) {
  const body = await readFile(detail.path, "utf8");
  assert.equal(createHash("sha256").update(body).digest("hex"), detail.bodySha256);
  captures.push({method: "GET", requestedUrl: detail.requestedUrl, requestBody: null, body,
    finalUrl: detail.finalUrl, httpStatus: detail.httpStatus, contentType: detail.contentType,
    capturedAt: new Date(detail.capturedAt).toISOString(), originalCapturedAt: detail.capturedAt, bodySha256: detail.bodySha256});
}
const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-lilly-china-social")!;
let observed = manifest.startedAt;
const used = new Set<number>();
let fetched: SourceFetchResult | undefined;
const fetch = createOfficialJsonSourceFetch({allowBrowserFallback: false, now: () => new Date(observed), http: async request => {
  const index = captures.findIndex((capture, i) => !used.has(i) && capture.requestedUrl === request.url &&
    capture.method === (request.method ?? "GET") && (capture.requestBody ?? null) === (request.body ?? null));
  assert.notEqual(index, -1, `Unexpected retained request: ${request.url}`);
  used.add(index);
  const capture = captures[index];
  assert.equal(createHash("sha256").update(capture.body).digest("hex"), capture.bodySha256);
  if (Date.parse(capture.capturedAt) > Date.parse(observed)) observed = capture.capturedAt;
  return {status: capture.httpStatus, finalUrl: capture.finalUrl, contentType: capture.contentType,
    capturedAt: capture.capturedAt, body: capture.body};
}});
const result = await runSourceCrawl(plan, {isBaseline: false, fetch: async (...args) => fetched = await fetch(...args)});
assert.equal(result.jobs.length, 88);
assert.equal(used.size, 91, "Every listed job must bind its original native detail response");
assert.equal(result.truth.completenessVerified, true);
for (const row of expected) {
  const job = result.jobs.find(job => job.sourceJobId === row.sourceJobId)!;
  assert.deepEqual(job.cities, row.cities);
  assert.equal(job.locationRaw, row.nativeLocationRaw);
  assert.equal(job.officialPublishedAt, row.officialPublishedAt);
}
const replay = (evidence = result.fetchEvidence!) => replayStrictSourceQualityEvidence({plan, evidence,
  jobs: result.jobs, capturedAt: result.observation.crawledAt.toISOString(),
  paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!});
assert.equal(replay(), true);
const mismatch = structuredClone(result.fetchEvidence!);
const detail = mismatch.artifacts.find(artifact => artifact.logicalKey.startsWith("lilly-detail-"))!;
detail.body = String(detail.body).replace(/"value"\s*:\s*"R-\d+"/u, '"value":"R-000000"');
assert.equal(replay(mismatch), false, "A different job's detail must not authorize the city");
await writeFile(join(directory, "native-detail-fetched.private.json"), JSON.stringify(fetched), {mode: 0o600});
await writeFile(join(directory, "native-detail-result.private.json"), JSON.stringify({plan, result}), {mode: 0o600});
await writeFile(join(directory, "native-detail-manifest.private.json"), JSON.stringify({...manifest,
  sourceConfigSha256: sourcePlanConfigSha256(plan), acquiredUnderSourceConfigSha256: manifest.sourceConfigSha256,
  finishedAt: observed, captures}), {mode: 0o600});
console.log(JSON.stringify({jobs: result.jobs.length, uniqueCities: new Set(result.jobs.flatMap(job => job.cities)).size,
  requests: used.size, artifacts: result.fetchEvidence!.artifacts.length, replay: true, mismatchedIdRejected: true,
  sourceConfigSha256: sourcePlanConfigSha256(plan), startedAt: manifest.startedAt, finishedAt: observed}));
