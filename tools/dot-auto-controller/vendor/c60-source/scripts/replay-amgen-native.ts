/** Offline parser/certificate diagnostic. Not a retained-capture importer or publication authority. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { AMGEN_NATIVE_CONFIG, createAmgenNativeSourceFetch } from "../src/crawler/amgenNativeSourceFetch";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../src/crawler/completenessCertificate";
const [capturePath, outputPath, ...extra] = process.argv.slice(2);
if (!capturePath || !outputPath || extra.length) throw Error("Usage: replay-amgen-native.ts <original-capture-directory> <diagnostic-output-directory>");
const input = resolve(capturePath), out = resolve(outputPath), hash = (body: string | Uint8Array) => createHash("sha256").update(body).digest("hex");
const readJson = async (name: string) => JSON.parse(await readFile(join(input, name), "utf8"));
const manifest = await readJson("handoff-manifest.json"), entry = await readJson("entry-fetch.json"), pagination = await readJson("native-page-captures.private.json"), details = await readJson("details-crosswalk.private.json");
const knownHashes = new Map<string, string>(manifest.files.map((f: { file: string; sha256: string }) => [f.file, f.sha256]));
const captures = [{ ...entry, file: "manual-entry.private.html", method: "GET" }, ...pagination, ...details.captures.map((c: object) => ({ ...c, method: "GET" }))];
const used = new Set<string>();
const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-amgen-china-social")!;
if (plan.adapterId !== "official-json") throw Error("Expected Amgen official-json plan");
// This historical diagnostic intentionally replays the immutable native V1 contract.
plan.profileBoundSource = { kind: "amgen-native-china", config: AMGEN_NATIVE_CONFIG };
const result = await runSourceCrawl(plan, { fetch: createAmgenNativeSourceFetch({ now: () => new Date(entry.finishedAt), http: async request => {
  const capture = captures.find(c => c.url === request.url && c.method === request.method && (request.method === "GET" || isDeepStrictEqual(c.requestBody, JSON.parse(request.body!))));
  if (!capture || used.has(capture.file)) throw Error("OFFLINE_REPLAY_REQUEST_NOT_CAPTURED");
  const body = await readFile(join(input, capture.file), "utf8");
  if (hash(body) !== knownHashes.get(capture.file) || capture.sha256 && hash(body) !== capture.sha256) throw Error("OFFLINE_REPLAY_ORIGINAL_HASH_MISMATCH");
  used.add(capture.file);
  return { body, status: capture.status, finalUrl: capture.finalUrl, capturedAt: new Date(capture.finishedAt).toISOString(),
    // Original captures omitted response headers. These MIME values permit an OFFLINE diagnostic only.
    contentType: capture.file.endsWith(".html") ? "text/html" : "application/json" };
  } }) });
const evidence = result.fetchEvidence;
const declaration = evidence?.artifacts.find(a => a.logicalKey === evidence.declaredCompleteness?.artifactLogicalKey);
const certificate = evidence && declaration && result.reconciliation && result.paginationEvaluation ? issueAGradeOfficialTotalCertificate({
  plan, transportSuccess: result.truth.transportSuccess, adapterSuccess: result.truth.adapterSuccess, evidence, paginationEvaluation: result.paginationEvaluation, reconciliation: result.reconciliation, jobs: result.jobs,
  officialArtifactSha256: hash(declaration.body), binding: { releaseCandidateId: "offline-amgen-native", batchId: "offline-amgen-native", sourceResultId: "offline-amgen-native", sourceConfigSha256: sourcePlanConfigSha256(plan) }
}) : null;
const report = { purpose: "OFFLINE_DIAGNOSTIC_NOT_PUBLICATION_AUTHORITY", responseHeaderLimitation: "Original MIME headers were not recorded; diagnostic MIME inferred from body format. Fresh publisher capture is mandatory.",
  sourceConfigSha256: sourcePlanConfigSha256(plan), consumedOriginals: used.size, expectedOriginals: captures.length, allOriginalsConsumed: used.size === captures.length,
  status: result.status, truth: result.truth, failureReason: result.failureReason, jobCount: result.jobs.length, pendingCities: result.jobs.filter(j => j.cities.includes("城市待核")).length,
  pageCounts: evidence?.pages.map(p => p.rawJobIds.length), certificateStatus: certificate?.status, certificateBlockers: certificate?.status === "REJECTED" ? certificate.blockerCodes : [],
  originalStartedAt: manifest.startedAt, originalFinishedAt: manifest.finishedAt };
await mkdir(out, { recursive: true });
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
await writeFile(join(out, "result.private.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
await writeFile(join(out, "certificate-diagnostic.json"), JSON.stringify(certificate, null, 2));
await writeFile(join(out, "plan.json"), JSON.stringify(plan, null, 2));
console.log(JSON.stringify(report, null, 2));
if (result.status !== "SUCCESS" || certificate?.status !== "CERTIFIED" || used.size !== captures.length) process.exitCode = 1;
