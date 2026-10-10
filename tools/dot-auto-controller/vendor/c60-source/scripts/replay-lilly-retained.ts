/** Read-only offline replay of retained bytes. No owned acquisition or live qualification. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../src/crawler/runSourceCrawl";
import { persistentOfficialJsonJobId } from "../src/crawler/officialJsonEvidence";
import { sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { lillyPlan } from "../tests/helpers/lillyPhenom";

const [evidencePath, auditPath, outputPath] = process.argv.slice(2);
if (!evidencePath || !auditPath || !outputPath) throw Error("Usage: node --import tsx scripts/replay-lilly-retained.ts <evidence.json> <business-audit.json> <new-report.json>");
const bytes = await readFile(evidencePath), evidence = JSON.parse(bytes.toString("utf8")), audit = JSON.parse(await readFile(auditPath, "utf8"));
if (createHash("sha256").update(bytes).digest("hex") !== audit.evidenceSha256) throw Error("RETAINED_EVIDENCE_HASH_MISMATCH");
for (const expected of audit.artifacts) {
  const artifact = evidence.artifacts.find((a: any) => a.logicalKey === expected.key);
  if (!artifact || createHash("sha256").update(artifact.body).digest("hex") !== expected.bodySha256) throw Error("RETAINED_ARTIFACT_HASH_MISMATCH");
}
const plan = lillyPlan(), capturedAt = audit.capturedAt; let index = 0, replayNow = capturedAt;
const fetch = createOfficialJsonSourceFetch({allowBrowserFallback: false, now: () => new Date(replayNow), http: async request => {
  const artifact = evidence.artifacts[index++];
  // Retained sanitization removed only the entry query. Reconstruct the exact
  // reviewed plan URL for offline transport, without making a source request.
  const expectedUrl = index === 1 ? plan.source.officialEntryUrl : "https://careers.lilly.com/widgets";
  if (!artifact || request.url !== expectedUrl || (request.method ?? "GET") !== (index === 1 ? "GET" : "POST")) throw Error("UNEXPECTED_OFFLINE_REPLAY_REQUEST");
  replayNow = artifact.capturedAt;
  return {status: artifact.httpStatus, capturedAt: artifact.capturedAt, body: artifact.body, finalUrl: expectedUrl, contentType: artifact.contentType};
}});
const result = await runSourceCrawl(plan, {fetch, isBaseline: false});
if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation) throw Error(`RETAINED_REPLAY_FETCH_FAILED:${JSON.stringify(result.observation)}`);
const replay = replayStrictSourceQualityEvidence({plan, evidence: result.fetchEvidence!, jobs: result.jobs, capturedAt,
  paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!});
if (!result.truth.completenessVerified || !replay || result.jobs.length !== audit.jobs.length || index !== evidence.artifacts.length) throw Error("RETAINED_REPLAY_FAILED");
const rows = evidence.artifacts.slice(1).flatMap((a: any) => JSON.parse(a.body).refineSearch.data.jobs);
for (const expected of audit.jobs) {
  const raw = rows.find((r: any) => r.reqId === expected.sourceJobIdOfficial);
  const job = raw && result.jobs.find(j => j.sourceJobId === persistentOfficialJsonJobId(raw.jobSeqNo));
  if (!job || job.officialTitle !== expected.title || job.officialUrl !== expected.officialUrl || job.locationRaw !== expected.locationRaw ||
    job.officialPublishedAt !== expected.proposedOfficialPublishedAt || !isDeepStrictEqual(job.cities, expected.proposedCities)) throw Error("RETAINED_RAW_OUTPUT_JOIN_MISMATCH");
  if (Object.hasOwn(job, "hiringManager")) throw Error("PRIVATE_FIELD_LEAK");
}
const report = {classification: "RETAINED_LILLY_OFFLINE_REPLAY_NO_ADMISSION_NO_LIVE_QUALIFICATION", capturedAt,
  sourceConfigSha256: sourcePlanConfigSha256(plan), retainedEvidenceSha256: audit.evidenceSha256,
  rows: result.jobs.length, citiesPending: result.jobs.filter(j => j.cities[0] === "城市待核").length,
  citiesShanghai: result.jobs.filter(j => j.cities[0] === "上海").length, exactOfficialDates: result.jobs.filter(j => j.officialPublishedAt).length,
  preApril2026OfficialDates: result.jobs.filter(j => j.officialPublishedAt! < "2026-04-01").length,
  allBusinessFieldsMatchAudit: true, strictReplay: replay, fetchLosses: result.fetchEvidence!.fetchLosses.length,
  networkRequests: 0, databaseWrites: 0, uploads: 0, importedEvidenceEligibleForAdmission: false};
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
console.log(JSON.stringify(report, null, 2));
