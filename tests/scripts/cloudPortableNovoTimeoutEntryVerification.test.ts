// @vitest-environment node
// OFFLINE VERIFICATION ONLY. This exercises the real PORTABLE entry and real
// owned acquisition/archive/bundle/restore/admissions. Build identity, public
// HTTP input, READ_CONTEXT and the final DB-publication seam are synthetic.
// A returned COMMITTED_EXACT below is a simulation, never a database claim.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { runCloudPortableSourcePilot } from "../../scripts/p0-cloud-portable-source-pilot";
import { CLOUD_PILOT_SOURCE } from "../../src/db/cloudPilotSqlControl";
import { deriveCurrentStagedScheduleExpectation } from "../../src/crawler/stagedScheduleAuthority";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { NOVO_CHINA_ENDPOINT, replayNovoChinaRows } from "../../src/crawler/novoChinaQuality";
import { NOVO_NATIVE_HEADERS } from "../../src/crawler/novoNativeTimeout";
import { officialRequestHeadersSha256 } from "../../src/crawler/officialHttpRuntimeLimits";
import * as limits from "../../src/crawler/officialHttpRuntimeLimits";
import * as archive from "../../src/crawler/artifactArchive";
import * as relay from "../../src/crawler/cloudSourcePilotRelay";
import * as quality from "../../src/crawler/sourceQualityAdmission";
import * as publication from "../../src/crawler/cloudDbStartedPilot";

// Explicit test-setup seam: physical runtime/build identity is NOT verified by
// this test. The frozen source snapshot is independently hash-checked outside it.
const syntheticBuild = vi.hoisted(() => ({ schemaVersion: 2 as const,
  commitSha: "e56e5c52f418376025c657ce35e62c0935c5794e", sourceTreeSha256: "b".repeat(64),
  runtimeTreeSha256: "c".repeat(64), contentSha256: "d".repeat(64) }));
vi.mock("../../src/readiness/buildIdentity", () => ({ resolveCurrentBuildIdentity: () => syntheticBuild }));

const START = Date.parse("2026-10-07T21:57:00.000Z");
const SOURCE_BUDGET_MS = 20 * 60_000, OUTER_BUDGET_MS = 30 * 60_000;
const SOURCE = "source-novo-nordisk-china-social";
const retainedList = readFileSync("tests/fixtures/novo-nordisk/retained-china-list-20261002.json", "utf8");
const retainedPages: Record<string, { body: string; finalUrl: string; contentType: string }> = JSON.parse(
  gunzipSync(readFileSync("tests/fixtures/novo-nordisk/retained-native-applications-20261002.json.gz")).toString());
const TARGET = Object.keys(retainedPages).find(url => url.includes("career_job_req_id=345925&"))!;
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const iso = (delta: number) => new Date(START + delta).toISOString();
const advance = (milliseconds: number) => vi.setSystemTime(Date.now() + milliseconds);
type Mode = "timeout-success" | "timeout-timeout" | "cancel-backoff" | "cancel-settlement";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function prepare(mode: Mode) {
  expect(process.version).toBe("v22.23.3");
  expect(process.env.JOBFINDER_CLOUD_SOURCE_ID).toBe(SOURCE);
  expect(CLOUD_PILOT_SOURCE.id).toBe(SOURCE);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START);
  vi.stubEnv("P0_SOURCE_HTTP_TIMEOUT_MS", "45000"); vi.stubEnv("P0_OFFICIAL_HTTP_DIAGNOSTICS_PATH", "");
  const artifactParent = join(process.cwd(), "verification-logs", "run-artifacts");
  await mkdir(artifactParent, { recursive: true });
  const workspaceRoot = await mkdtemp(join(artifactParent, mode + "-"));
  const expectation = deriveCurrentStagedScheduleExpectation(syntheticBuild);
  expect(expectation.plans).toHaveLength(41);
  const plan = expectation.plans.find(p => p.source.id === SOURCE)!;
  const candidate = { id: "synthetic-portable-entry-only", status: "BUILDING", commitSha: expectation.commitSha,
    rosterHash: expectation.rosterSha256, sourcePlanHash: expectation.sourcePlanSha256,
    sourceConfigHash: expectation.sourceConfigSha256, adapterBundleHash: expectation.adapterBundleSha256,
    sourceTreeHash: expectation.sourceTreeSha256, runtimeTreeHash: expectation.runtimeTreeSha256,
    oracleVersion: "staged-official-source-v1", minimumStableCompanyCount: 41 };
  const batchId = `synthetic-portable-novo-${mode}`;
  const bootstrapPath = join(workspaceRoot, "bootstrap.json");
  const bootstrapBytes = JSON.stringify({ schemaVersion: 1, checkedAt: iso(0), candidateRows: [candidate], batchId });
  await writeFile(bootstrapPath, bootstrapBytes, { flag: "wx" });
  const controlPath = join(workspaceRoot, "synthetic-publication-seam-only.json");
  await writeFile(controlPath, JSON.stringify({ classification: "SYNTHETIC_PUBLICATION_SEAM_ONLY", sqlExecuted: false }), { flag: "wx" });
  const owner = new AbortController(), realTimeout = globalThis.setTimeout;
  let timer: AbortController | undefined;
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { expect(ms).toBe(45_000); timer = new AbortController(); return timer.signal; });
  const delays: number[] = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    if (ms !== 10_000) return realTimeout(callback, ms, ...args);
    delays.push(ms);
    return realTimeout(() => {
      advance(ms);
      if (mode === "cancel-backoff") owner.abort(new Error("SYNTHETIC_CANCEL_DURING_BACKOFF"));
      else callback(...args);
    }, 0);
  }) as typeof setTimeout);
  const counts = new Map<string, number>();
  const httpCalls: Array<{ url: string; at: number }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string") throw Error("NON_STRING_SYNTHETIC_URL");
    expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined(); expect(init?.redirect).toBe("follow");
    const count = (counts.get(input) ?? 0) + 1; counts.set(input, count);
    expect(count).toBeLessThanOrEqual(2); httpCalls.push({ url: input, at: Date.now() });
    const retained = input === NOVO_CHINA_ENDPOINT
      ? { body: retainedList, finalUrl: input, contentType: "application/json;charset=utf-8" } : retainedPages[input];
    if (!retained) throw Error("UNEXPECTED_OFFLINE_URL");
    if (input === TARGET && (count === 1 || mode === "timeout-timeout")) {
      const requestTimer = timer!, signal = init!.signal!;
      expect(officialRequestHeadersSha256(init?.headers)).toBe(officialRequestHeadersSha256(NOVO_NATIVE_HEADERS));
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          if (mode !== "cancel-settlement") reject(signal.reason);
        }, { once: true });
        realTimeout(() => {
          advance(45_000); requestTimer.abort(new DOMException("Synthetic request deadline", "TimeoutError"));
          if (mode === "cancel-settlement") realTimeout(() => {
            advance(1_000); owner.abort(new Error("SYNTHETIC_CANCEL_DURING_SETTLEMENT")); reject(signal.reason);
          }, 0);
        }, 0);
      });
    }
    return { status: 200, url: retained.finalUrl, headers: new Headers({ "content-type": retained.contentType }), text: async () => retained.body };
  }));
  // These spies observe the original functions without replacing their bodies.
  const sourceTimer = vi.spyOn(limits, "runWithOfficialSourceAttemptTimeout");
  const admissions = vi.spyOn(quality, "issueSourceQualityAdmission");
  const archives = vi.spyOn(archive, "archiveSourceEvidence");
  const bundles = vi.spyOn(relay, "makeArchiveBundle");
  const restores = vi.spyOn(relay, "restoreArchiveBundle");
  const sqlCalls = vi.spyOn(relay.FilePilotRelay.prototype, "sql");
  const outerChecks = vi.spyOn(publication, "requireDbStartedOuterDeadline");
  const events: string[] = [];
  const context = vi.spyOn(relay.FilePilotRelay.prototype, "request").mockImplementation(async (kind, payload, deadline, parse, signal) => {
    expect(kind).toBe("READ_CONTEXT"); expect(payload).toMatchObject({ sourceId: SOURCE,
      sourceConfigSha256: sourcePlanConfigSha256(plan), purpose: "PRE_CAPTURE" });
    expect(deadline).toBe(START + relay.PILOT_BUDGET.controlMs); expect(signal).toBe(owner.signal);
    events.push("SYNTHETIC_READ_CONTEXT");
    return parse({ checkedAt: iso(0), sourceId: SOURCE, sourceConfigSha256: sourcePlanConfigSha256(plan),
      jobs: [], firstAccepted: null, latestAccepted: null });
  });
  const publish = vi.spyOn(publication, "runDbStartedCloudPublication").mockImplementation(async input => {
    events.push("SYNTHETIC_PUBLICATION_SEAM");
    expect(mode).toBe("timeout-success");
    expect(archives).toHaveBeenCalledTimes(1); expect(bundles).toHaveBeenCalledTimes(1); expect(restores).toHaveBeenCalledTimes(1);
    expect(admissions).toHaveBeenCalledTimes(2);
    const receipts = await Promise.all(admissions.mock.results.map(result => result.value));
    expect(receipts.map(receipt => receipt.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    expect(input.source.sourceQualityAdmission?.status).toBe("ACCEPTED");
    expect(input.source.sourceAdmissionPolicy).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    expect(input.initialCertificate).toEqual(receipts[0]!.receipt);
    expect(input.initialCertificate).toEqual(receipts[1]!.receipt);
    expect(input.initialCertificate).toMatchObject({ counts: { rawCount: 27, validCount: 20,
      validationDiscardCount: 7, finalUniqueJobCount: 20 }, acquisition: { startedAt: iso(0), finishedAt: iso(55_000) } });
    expect(sourceTimer).toHaveBeenCalledTimes(1); expect(sourceTimer.mock.calls[0]![1]).toBe(SOURCE_BUDGET_MS);
    expect(outerChecks).toHaveBeenCalledWith(START + OUTER_BUDGET_MS);
    expect(input.overallDeadline).toBe(START + OUTER_BUDGET_MS);
    expect(input.overallDeadline - START).toBe(30 * 60_000);
    expect(input.controlPath).toBe(controlPath); expect(input.signal).toBe(owner.signal);
    expect(input.source.result.jobs).toHaveLength(20); expect(input.source.result.fetchEvidence!.fetchLosses).toHaveLength(7);
    expect(input.source.attemptTracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
    const drafts = input.source.result.fetchEvidence!.artifacts;
    const index = drafts.findIndex(a => a.logicalKey === "novo-application-345925.en_GB-request-error-1");
    const error = drafts[index]!, retry = drafts[index + 1]!, success = drafts[index + 2]!;
    expect(error.kind).toBe("COMMAND_OUTPUT"); expect(error).not.toHaveProperty("httpStatus");
    expect(JSON.parse(String(error.body))).toMatchObject({ kind: "NO_RESPONSE_REQUEST_ERROR", code: "OFFICIAL_HTTP_TIMEOUT",
      requestedUrlSha256: sha256(TARGET), requestHeadersSha256: officialRequestHeadersSha256(NOVO_NATIVE_HEADERS),
      requestStartedAt: iso(0), timeoutAt: iso(45_000), settledAt: iso(45_000), sourceDeadlineAt: iso(SOURCE_BUDGET_MS),
      responseReceived: false, settlement: "FETCH_REJECTED", timeoutMs: 45_000 });
    expect(JSON.parse(String(retry.body))).toMatchObject({ kind: "REQUEST_RETRY_START", attempt: 2, startedAt: iso(55_000),
      sourceDeadlineAt: iso(SOURCE_BUDGET_MS), requestedUrlSha256: sha256(TARGET) });
    expect(success).toMatchObject({ logicalKey: "novo-application-345925.en_GB", kind: "OFFICIAL_COMPANY_PAGE", httpStatus: 200, capturedAt: iso(55_000) });
    expect(drafts).toHaveLength(58); expect(input.source.artifacts).toHaveLength(58);
    const before = admissions.mock.calls[0]![0].archive, restored = admissions.mock.calls[1]![0].archive;
    expect(before.workspaceRoot).toBe(workspaceRoot); expect(restored.workspaceRoot).toContain("verified-restore-");
    expect(restored.workspaceRoot).not.toBe(workspaceRoot);
    expect(input.source.artifacts).toEqual(restored.artifacts);
    // Re-read each restored file; then replay those bytes independently once more.
    const independent = structuredClone(input.source.result.fetchEvidence!);
    independent.artifacts = await Promise.all(restored.artifacts.map(async artifact => {
      const bytes = await readFile(join(restored.workspaceRoot, artifact.path));
      expect(sha256(bytes)).toBe(artifact.sha256); expect(bytes.byteLength).toBe(artifact.byteCount);
      return { ...drafts.find(draft => draft.logicalKey === artifact.logicalKey)!, id: artifact.id, body: bytes.toString() };
    }));
    expect(replayNovoChinaRows(input.source.plan, independent, input.source.result.jobs,
      input.source.result.observation.crawledAt.toISOString())).toBe(true);
    expect(sqlCalls).not.toHaveBeenCalled();
    return { state: "COMMITTED_EXACT" as const, publishAcknowledged: false, batchFinalizationRequired: false, jobCount: 20,
      publicationMode: "DB_STARTED_OWNER_V1" as const, syntheticPublicationOnly: true, sqlExecuted: false,
      liveAcquisition: false, physicalBuildIdentityVerified: false, classification: "SYNTHETIC_PUBLICATION_SEAM_ONLY" };
  });
  const run = () => runCloudPortableSourcePilot({ bootstrapPath, reviewedSha256: sha256(bootstrapBytes), workspaceRoot,
    relayDirectory: join(workspaceRoot, "relay"), signal: owner.signal, dbStartedControlPath: controlPath,
    overallDeadline: START + OUTER_BUDGET_MS });
  return { run, workspaceRoot, batchId, counts, httpCalls, delays, sourceTimer, admissions, archives, bundles, restores,
    sqlCalls, outerChecks, context, publish, events, owner };
}

describe("actual PORTABLE Novo entry with frozen source and synthetic external boundaries", () => {
  it("runs timeout→200 through both real owned admissions and original archive bundle restoration before a simulated publication seam", async () => {
    const fixture = await prepare("timeout-success"), result = await fixture.run();
    expect(result).toMatchObject({ state: "COMMITTED_EXACT", sourceId: SOURCE, jobCount: 20,
      syntheticPublicationOnly: true, sqlExecuted: false, liveAcquisition: false, physicalBuildIdentityVerified: false,
      classification: "SYNTHETIC_PUBLICATION_SEAM_ONLY", archiveRetention: "PENDING", recoveryVerification: "PENDING" });
    expect(fixture.publish).toHaveBeenCalledTimes(1); expect(fixture.context).toHaveBeenCalledTimes(1);
    expect(fixture.events).toEqual(["SYNTHETIC_READ_CONTEXT", "SYNTHETIC_PUBLICATION_SEAM"]);
    expect(fixture.httpCalls).toHaveLength(57); expect(fixture.counts.get(TARGET)).toBe(2);
    expect(fixture.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1); expect(fixture.delays).toEqual([10_000]);
    expect(sha256(await readFile(result.bundlePath))).toBe(result.bundleSha256);
    const persisted = JSON.parse(await readFile(join(fixture.workspaceRoot, `${fixture.batchId}.outcome.json`), "utf8"));
    expect(persisted).toEqual(result); expect(fixture.sqlCalls).not.toHaveBeenCalled();
    console.log(JSON.stringify({ classification: "OFFLINE_PORTABLE_ENTRY_VERIFICATION", mode: "timeout-success",
      simulatedPublicationOnly: true, physicalBuildIdentityVerified: false, sqlExecuted: false,
      httpCalls: fixture.httpCalls.length, admissions: 2, archiveArtifacts: 58, jobs: 20, closures: 7,
      originalSourceBudgetMs: SOURCE_BUDGET_MS, originalOuterBudgetMs: OUTER_BUDGET_MS, workspaceRoot: fixture.workspaceRoot }));
  });

  it.each(["timeout-timeout", "cancel-backoff", "cancel-settlement"] as const)("stops %s before archive, admission or the publication seam", async mode => {
    const fixture = await prepare(mode);
    await expect(fixture.run()).rejects.toThrow("PILOT_SUCCESSFUL_SOURCE_ONLY_FAILURE_FINALIZATION_REQUIRED");
    expect(fixture.publish).not.toHaveBeenCalled(); expect(fixture.sqlCalls).not.toHaveBeenCalled();
    expect(fixture.archives).not.toHaveBeenCalled(); expect(fixture.bundles).not.toHaveBeenCalled(); expect(fixture.restores).not.toHaveBeenCalled();
    expect(fixture.admissions).not.toHaveBeenCalled(); expect(fixture.context).toHaveBeenCalledTimes(1);
    expect(fixture.counts.get(NOVO_CHINA_ENDPOINT)).toBe(1);
    expect(fixture.counts.get(TARGET)).toBe(mode === "timeout-timeout" ? 2 : 1);
    expect(fixture.delays).toEqual(mode === "cancel-settlement" ? [] : [10_000]);
    expect(fixture.sourceTimer.mock.calls[0]![1]).toBe(SOURCE_BUDGET_MS);
    expect(fixture.outerChecks).toHaveBeenCalledWith(START + OUTER_BUDGET_MS);
    const failureFiles = (await readdir(fixture.workspaceRoot)).filter(file => file.includes(".failure-"));
    expect(failureFiles).toHaveLength(1);
    const failure = JSON.parse(await readFile(join(fixture.workspaceRoot, failureFiles[0]!), "utf8"));
    expect(failure.phase).toBe("CHECK_SOURCE_RESULT"); expect(failure.crawlResult.status).toBe("FAILED");
    expect(failure.crawlResult.jobs).toEqual([]);
    const errors = failure.crawlResult.fetchEvidence.artifacts.filter((artifact: { logicalKey: string }) => artifact.logicalKey.includes("-request-error-"));
    expect(errors).toHaveLength(mode === "timeout-timeout" ? 2 : mode === "cancel-backoff" ? 1 : 0);
    expect(failure.attempts).toMatchObject({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
    expect((await readdir(fixture.workspaceRoot)).some(file => file.endsWith(".outcome.json") || file.endsWith(".archive.json"))).toBe(false);
    console.log(JSON.stringify({ classification: "OFFLINE_PORTABLE_ENTRY_VERIFICATION", mode, sqlExecuted: false,
      publicationSeamReached: false, admissions: 0, retainedTimeoutErrors: errors.length,
      targetCalls: fixture.counts.get(TARGET), originalSourceBudgetMs: SOURCE_BUDGET_MS,
      originalOuterBudgetMs: OUTER_BUDGET_MS, workspaceRoot: fixture.workspaceRoot }));
  });
});
