import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hooks = registerHooks({
  load(url, context, next) {
    const stubs = {
      "/src/db/crawlRuntimeRepository.ts": "export const createPrismaCrawlRuntimeDeps = () => ({});",
      "/src/crawler/portableCrawlLease.ts": "export const withPortableCrawlLease = (db, run) => run(db.lease);",
      "/scripts/recover-direct.ts": "export const recoverDirectBatches = async () => {};",
      "/src/crawler/runCrawlBatch.ts": "export const runP0CrawlBatch = (plans, deps) => deps.db.capture(plans, deps);"
    };
    const key = Object.keys(stubs).find(suffix => url.endsWith(suffix));
    return key ? { format: "module", shortCircuit: true, source: stubs[key] } : next(url, context);
  }
});
const { loadDirectPlans, runDirectRound } = await import("../runner-candidate/scripts/direct-round.ts");
hooks.deregister();

import * as runnerHold from "../runner-candidate/src/release/portableSourceCoverageHolds.ts";
import * as webHold from "../web-candidate/src/release/portableSourceCoverageHolds.ts";
import { candidateCompanies } from "../web-candidate/src/data/companyRegistry.ts";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../web-candidate/src/crawler/sourcePlan.ts";
import { hashCanonicalStringSet } from "../web-candidate/src/crawler/runtimeBatchIdentity.ts";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA } from "../web-candidate/src/crawler/sourceQualityAdmission.ts";
import { PORTABLE_COVERAGE_POLICY_ID } from "../web-candidate/src/release/portableCoveragePolicy.ts";
import { selectPortableSourceSnapshots } from "../web-candidate/src/domain/portablePublicSnapshot.ts";
import { coverageFromPortableSnapshot, searchPortableSnapshot } from "../web-candidate/src/server/portablePublicationApi.ts";
import { installSavedSnapshot, validateSavedSnapshot } from "../web-candidate/src/server/savedPublicSnapshot.ts";
import { createRefreshStatusReader } from "../web-candidate/src/server/savedRefreshStatus.ts";
import { runRefresh } from "./refresh.ts";

const BIOGEN_SOURCE_ID = "source-biogen-china-social";
const BIOGEN_COMPANY_ID = "company-biogen-china";
const catalog = JSON.parse(readFileSync(new URL("../runner-candidate/sources.json", import.meta.url), "utf8")).rows;
const readerPlans = buildStagedSourceCrawlPlans(candidateCompanies);

test("Biogen temporary pause boundaries match 2026-11-22 00:01 to 2026-11-29 00:01 CST across both trees", () => {
  assert.deepEqual(runnerHold.TEMPORARY_SOURCE_PAUSES, webHold.TEMPORARY_SOURCE_PAUSES);
  const pause = webHold.TEMPORARY_SOURCE_PAUSES[BIOGEN_SOURCE_ID];
  assert.equal(pause.pausedFromIso, "2026-11-22T00:01:00+08:00");
  assert.equal(pause.pausedUntilIso, "2026-11-29T00:01:00+08:00");

  const fromMs = Date.parse(pause.pausedFromIso);
  const untilMs = Date.parse(pause.pausedUntilIso);
  for (const mod of [runnerHold, webHold]) {
    assert.equal(mod.isSourceTemporarilyPaused(BIOGEN_SOURCE_ID, fromMs - 1), false);
    assert.equal(mod.getPortableSourceCoverageHold(BIOGEN_SOURCE_ID, fromMs - 1), null);
    assert.equal(mod.isSourceTemporarilyPaused(BIOGEN_SOURCE_ID, fromMs), true);
    assert.equal(mod.getPortableSourceCoverageHold(BIOGEN_SOURCE_ID, fromMs), mod.SOURCE_COVERAGE_REVIEW_PENDING);
    assert.equal(mod.isSourceTemporarilyPaused(BIOGEN_SOURCE_ID, untilMs - 1), true);
    assert.equal(mod.getPortableSourceCoverageHold(BIOGEN_SOURCE_ID, untilMs - 1), mod.SOURCE_COVERAGE_REVIEW_PENDING);
    assert.equal(mod.isSourceTemporarilyPaused(BIOGEN_SOURCE_ID, untilMs), false);
    assert.equal(mod.getPortableSourceCoverageHold(BIOGEN_SOURCE_ID, untilMs), null);
    assert.equal(mod.isSourceTemporarilyPaused("source-pfizer-china-social", fromMs + 1000), false);
  }
});

test("paused Biogen source holds cleanly without degrading coverage summary and restores after expiry", () => {
  const plan = readerPlans.find(entry => entry.source.id === BIOGEN_SOURCE_ID);
  assert.ok(plan);
  const configHash = sourcePlanConfigSha256(plan);
  const makeCommittedRow = (atIso, id) => ({
    id,
    releaseCandidateId: "instabox-synthetic",
    batchId: `batch-${id}`,
    sourceId: BIOGEN_SOURCE_ID,
    sourceConfigHash: configHash,
    transportState: "SUCCEEDED",
    adapterState: "SUCCEEDED",
    completenessState: "VERIFIED",
    atomicCommitState: "COMMITTED",
    failureCode: null,
    failureReason: null,
    blockerCode: null,
    blockerReason: null,
    startedAt: new Date(atIso),
    finishedAt: new Date(atIso),
    dedupeOutputCount: 1,
    canonicalCurrentJobSetSha256: hashCanonicalStringSet(["bio-job-1"]),
    canonicalGraceJobSetSha256: hashCanonicalStringSet([]),
    canonicalVisibleJobSetSha256: hashCanonicalStringSet(["bio-job-1"]),
    observations: [{ crawledAt: new Date(atIso) }],
    completenessCertificateSha256: "a".repeat(64),
    completenessCertificate: {
      schemaVersion: SOURCE_QUALITY_RECEIPT_SCHEMA,
      policyId: SOURCE_QUALITY_POLICY_ID,
      observation: { crawledAt: atIso },
      counts: { finalUniqueJobCount: 1, validationDiscardCount: 0 }
    },
    batch: { id: `batch-${id}`, releaseCandidateId: "instabox-synthetic", kind: "SCHEDULED", status: "SUCCESS" }
  });

  const beforePause = selectPortableSourceSnapshots(
    [plan],
    [makeCommittedRow("2026-11-21T04:22:00+08:00", "pre")],
    { currentTime: new Date("2026-11-21T23:59:00+08:00") }
  )[0];
  assert.equal(beforePause.state, "PUBLISHING");
  assert.equal(beforePause.health, "HEALTHY");

  const duringPause = selectPortableSourceSnapshots(
    [plan],
    [makeCommittedRow("2026-11-21T04:22:00+08:00", "pre")],
    { currentTime: new Date("2026-11-22T01:30:00+08:00") }
  )[0];
  assert.equal(duringPause.state, "HOLD");
  assert.equal(duringPause.health, "UNVERIFIED");
  assert.deepEqual(duringPause.reasons, ["SOURCE_COVERAGE_REVIEW_PENDING"]);
  assert.equal(duringPause.selected, null);

  const afterPause = selectPortableSourceSnapshots(
    [plan],
    [makeCommittedRow("2026-11-29T00:10:00+08:00", "post")],
    { currentTime: new Date("2026-11-29T01:00:00+08:00") }
  )[0];
  assert.equal(afterPause.state, "PUBLISHING");
  assert.equal(afterPause.health, "HEALTHY");

  const { selected: _ignored, ...biogenSourceStatus } = duringPause;
  const generatedAt = "2026-11-22T01:30:00+08:00";
  const snapshot = validateSavedSnapshot({
    schemaVersion: "portable-public-snapshot-v1",
    policyId: SOURCE_QUALITY_POLICY_ID,
    coveragePolicyId: PORTABLE_COVERAGE_POLICY_ID,
    generatedAt,
    lastUpdatedAt: generatedAt,
    totalJobs: 1,
    companies: [
      {
        id: BIOGEN_COMPANY_ID,
        companyName: "渤健中国",
        pinyin: "bojian",
        category: "FOREIGN_PHARMA",
        sourceIds: [BIOGEN_SOURCE_ID],
        publishingSourceIds: [],
        required: true,
        exclusionReason: null,
        health: "UNVERIFIED",
        coverage: "UNVERIFIED",
        jobs: []
      },
      {
        id: "company-abbvie-china",
        companyName: "艾伯维中国",
        pinyin: "aibowei",
        category: "FOREIGN_PHARMA",
        sourceIds: ["source-abbvie-china-social"],
        publishingSourceIds: ["source-abbvie-china-social"],
        required: true,
        exclusionReason: null,
        health: "HEALTHY",
        coverage: "COMPLETE",
        jobs: [{
          id: "abbvie-job-1",
          title: "Medical Science Liaison",
          officialTitle: "Medical Science Liaison",
          officialPublishedAt: null,
          city: "上海",
          cities: ["上海"],
          locationRaw: "Shanghai",
          category: "医学事务",
          isNew: false,
          officialUrl: "https://careers.abbvie.com/job/1",
          companyId: "company-abbvie-china",
          sourceId: "source-abbvie-china-social",
          sourceResultId: "abbvie-res-1",
          lastSeenAt: generatedAt,
          inGrace: false
        }]
      }
    ],
    sources: [{ ...biogenSourceStatus, visibleJobCount: null, staleJobCount: 0, jobs: [] }],
    coverage: {
      companyCount: 2,
      requiredCompanyCount: 2,
      excludedCompanyCount: 0,
      requiredSourceCount: 2,
      excludedSourceCount: 0,
      expectedSourceCount: 2,
      sourceCount: 1,
      unplannedSourceCount: 0,
      publishingSourceCount: 1,
      unsupportedSourceCount: 0,
      heldSourceCount: 1
    }
  });

  const search = searchPortableSnapshot({ city: "全部城市", province: "全部地区", sort: "COMPANY_PINYIN_ASC" }, snapshot);
  assert.equal(search.totalJobs, 1);
  assert.equal(search.companies.some(c => c.id === BIOGEN_COMPANY_ID), false);
  assert.equal(search.coverageSummary.publishingCompanyCount, 1);
  assert.equal(search.coverageSummary.degradedCompanyCount, 0);

  const coverage = coverageFromPortableSnapshot({ keyword: "渤健", offset: 0, limit: 60 }, snapshot);
  assert.equal(coverage.companies.length, 1);
  assert.equal(coverage.companies[0].id, BIOGEN_COMPANY_ID);
  assert.equal(coverage.companies[0].state, "VERIFYING");
  assert.equal(coverage.companies[0].health, "NOT_APPLICABLE");
  assert.match(coverage.companies[0].sourceScopeNote ?? "", /暂停采集并暂时下线一周/);
  assert.equal(coverage.companies[0].officialCareersUrl, "https://biibhr.wd3.myworkdayjobs.com/external");
});

test("runDirectRound skips Biogen during paused slot (35 calls) and restores all 36 afterwards", async () => {
  const routes = await loadDirectPlans();
  assert.equal(routes.length, 36);
  const calls = [];
  const candidate = { id: "instabox-pause-test", goalId: "job-finder-instabox-migration", status: "BUILDING" };
  const db = {
    releaseCandidate: { findUniqueOrThrow: async () => candidate },
    recruitmentSource: { findMany: async () => routes.map(({ sourceId: id, companyId }) => ({ id, companyId })) },
    crawlBatchSourceResult: { findFirst: async () => null, findMany: async () => [] },
    crawlBatch: { findFirst: async () => null },
    capture: async plans => { calls.push(plans[0].source.id); return { status: "SUCCESS" }; }
  };
  const cache = fileURLToPath(new URL("../.runtime/.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const workspaceRoot = await mkdtemp(join(cache, "biogen-direct-"));
  try {
    const pausedSlot = String(Date.parse("2026-11-22T00:01:00+08:00"));
    const duringResults = await runDirectRound({
      db, leaseDb: { lease: { signal: new AbortController().signal } },
      candidateId: candidate.id, workspaceRoot, slot: pausedSlot
    });
    assert.equal(duringResults.length, 35);
    assert.equal(calls.length, 35);
    assert.equal(calls.includes(BIOGEN_SOURCE_ID), false);

    calls.length = 0;
    const resumedSlot = String(Date.parse("2026-11-29T00:01:00+08:00"));
    const afterResults = await runDirectRound({
      db, leaseDb: { lease: { signal: new AbortController().signal } },
      candidateId: candidate.id, workspaceRoot, slot: resumedSlot
    });
    assert.equal(afterResults.length, 36);
    assert.equal(calls.length, 36);
    assert.equal(calls.includes(BIOGEN_SOURCE_ID), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("runRefresh validates pausedSources strictly against receipt slot and surfaces pausedSourceIds", async t => {
  const cache = fileURLToPath(new URL("../.runtime/.cache/", import.meta.url));
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, "biogen-refresh-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, "public.json");
  const stateFile = target + ".schedule.json";
  const pausedSlotMs = Date.parse("2026-11-22T00:01:00+08:00");
  const pausedSlot = String(pausedSlotMs);
  await writeFile(stateFile, JSON.stringify({ timerSlots: [pausedSlot], records: [] }));

  const snapshot = {
    schemaVersion: "portable-public-snapshot-v1",
    policyId: SOURCE_QUALITY_POLICY_ID,
    coveragePolicyId: PORTABLE_COVERAGE_POLICY_ID,
    generatedAt: new Date(pausedSlotMs).toISOString(),
    lastUpdatedAt: null,
    totalJobs: 0,
    companies: [],
    sources: [],
    coverage: {
      companyCount: 0, requiredCompanyCount: 0, excludedCompanyCount: 0,
      requiredSourceCount: 0, excludedSourceCount: 0, expectedSourceCount: 0,
      sourceCount: 0, unplannedSourceCount: 0, publishingSourceCount: 0,
      unsupportedSourceCount: 0, heldSourceCount: 0
    }
  };
  const bytes = JSON.stringify(snapshot);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const activeCoverage = catalog
    .filter(row => row.sourceId !== BIOGEN_SOURCE_ID)
    .map(row => ({ sourceId: row.sourceId, batchId: "test-" + row.sourceId }));

  const makeOptions = receiptTemplate => {
    const receipts = new Map();
    const jobs = new Map();
    return {
      now: pausedSlotMs + 1000,
      env: { INSTABOX_API_KEY: "SYNTHETIC_TEST_KEY", JOBFINDER_PUBLIC_SNAPSHOT_FILE: target, JOBFINDER_VERIFY_BASE_URL: "https://synthetic.invalid" },
      installSnapshot: async (...args) => {
        try { await installSavedSnapshot(...args); }
        catch (error) {
          if (process.platform !== "win32" || error.message !== "PUBLIC_SNAPSHOT_DURABILITY_UNCONFIRMED") throw error;
        }
      },
      execute: async (_cli, args) => {
        const state = JSON.parse(await readFile(stateFile, "utf8"));
        if (args[0] === "pull") {
          const round = args[2].match(/\/round-([a-f0-9]{32})\.json$/)?.[1];
          await writeFile(args[3], round ? JSON.stringify(receipts.get(round)) : bytes);
        } else if (args[0] === "exec") {
          const jobId = `synthetic-job-${jobs.size + 1}`;
          jobs.set(jobId, { ...receiptTemplate, slot: args.at(-2), roundId: args.at(-1) });
          return { stdout: JSON.stringify({ jobId }), stderr: "" };
        } else if (args[0] === "jobs") {
          const result = jobs.get(args[3]);
          receipts.set(result.roundId, result);
        }
        return { stdout: "", stderr: "" };
      },
      acquireActivityLease: async () => async () => {},
      request: async url => {
        const query = Object.fromEntries(url.searchParams);
        const expected = url.pathname === "/api/search"
          ? searchPortableSnapshot(query, snapshot)
          : coverageFromPortableSnapshot({ keyword: query.keyword, offset: Number(query.offset), limit: Number(query.limit) }, snapshot);
        return Response.json({ ...expected, snapshotStorage: "SAVED" });
      }
    };
  };

  t.mock.method(console, "log", () => {});
  const errors = [];
  t.mock.method(console, "error", value => errors.push(JSON.parse(value)));

  // 1. Valid 35-captured + 1 paused convergence receipt
  const validReceipt = {
    slot: pausedSlot,
    complete: true,
    snapshotFile: `/data/job-finder/snapshots/public-${sha256}.json`,
    sha256,
    lastUpdatedAt: null,
    totalJobs: 0,
    capturedSources: activeCoverage,
    pausedSources: [BIOGEN_SOURCE_ID],
    retrySources: []
  };
  assert.equal(await runRefresh(makeOptions(validReceipt)), 0);
  const stateAfter = JSON.parse(await readFile(stateFile, "utf8"));
  assert.deepEqual(stateAfter.progress, { slot: pausedSlot, nextRetryAt: null });
  assert.equal(stateAfter.records[0].complete, true);
  assert.equal(stateAfter.records[0].capturedSourceIds.length, 35);
  assert.deepEqual(stateAfter.records[0].pausedSourceIds, [BIOGEN_SOURCE_ID]);
  const publicStatus = await createRefreshStatusReader(target)();
  assert.equal(publicStatus.status, "AVAILABLE");
  assert.deepEqual(publicStatus.records[0].pausedSourceIds, [BIOGEN_SOURCE_ID]);

  // 2. Reject receipts missing pausedSources, containing duplicates/unknowns, or used on non-paused slot
  for (const [badSlot, badReceipt] of [
    [pausedSlotMs, { ...validReceipt, pausedSources: undefined }],
    [pausedSlotMs, { ...validReceipt, pausedSources: [BIOGEN_SOURCE_ID, BIOGEN_SOURCE_ID] }],
    [pausedSlotMs, { ...validReceipt, pausedSources: [BIOGEN_SOURCE_ID, activeCoverage[0].sourceId] }],
    [Date.parse("2026-11-29T00:01:00+08:00"), validReceipt]
  ]) {
    errors.length = 0;
    const badSlotStr = String(badSlot);
    await writeFile(stateFile, JSON.stringify({ timerSlots: [badSlotStr], records: [] }));
    const code = await runRefresh({
      ...makeOptions({ ...badReceipt, slot: badSlotStr }),
      now: badSlot + 1000
    });
    assert.equal(code, 76);
    assert.equal(errors.at(-1)?.status, "ROUND_RECEIPT_SOURCE_COVERAGE_MISMATCH");
  }
});
