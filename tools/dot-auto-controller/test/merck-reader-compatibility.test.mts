// Offline read-boundary regression. New commits below are synthetic fixtures, never publication authority.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
const [originalPackage, beforePath, probeDirectory, failurePath, outputPath] = process.argv.slice(2);
assert(originalPackage && beforePath && probeDirectory && failurePath && outputPath);
const candidatePackage = path.resolve(import.meta.dirname, "..");
const load = (root: string, file: string) => import(pathToFileURL(path.join(root, file)).href);
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const SOURCE = "source-merck-china-social";
const OLD = "3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38";
const CURRENT = "1f4b28ecba11e7fd299e51d7cd351529983d086ef18a2b5bd005e431812db212";
const rawBefore = read(beforePath), probe = read(path.join(probeDirectory, "summary.json"));
const at = probe.endedAt, now = new Date(Date.parse(at) + 60_000);
const dt = (value: string | null) => value == null ? null : new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z");
function revive(raw: any, toCategory: (value: string) => string) {
  return {...raw, results: raw.results.map((r: any) => ({...r, startedAt: dt(r.startedAt), finishedAt: dt(r.finishedAt),
    batch: {...r.batch, startedAt: dt(r.batch.startedAt), finishedAt: dt(r.batch.finishedAt)},
    observations: r.observations.map((o: any) => ({...o, observedFrom: dt(o.observedFrom), observedTo: dt(o.observedTo), crawledAt: dt(o.crawledAt)}))})),
    jobs: raw.jobs.map((j: any) => ({...j, lastSeenAt: dt(j.lastSeenAt), officialPublishedAt: dt(j.officialPublishedAt),
      category: toCategory(j.category), humanCorrectedCategory: j.humanCorrectedCategory == null ? null : toCategory(j.humanCorrectedCategory)}))};
}
const native = path.join(originalPackage, "vendor/c60-source");
const {accepted} = await load(native, "tests/helpers/portablePublicSnapshotFixture.ts");
const nativePlans = await load(native, "src/crawler/sourcePlan.ts");
const nativeRegistry = await load(native, "src/data/companyRegistry.ts");
const nativePlan = nativePlans.buildStagedSourceCrawlPlans(nativeRegistry.candidateCompanies).find((p: any) => p.source.id === SOURCE);
assert.equal(nativePlans.sourcePlanConfigSha256(nativePlan), CURRENT);
const {createOfficialJsonSourceFetch} = await load(native, "src/crawler/officialJsonSourceFetch.ts");
const {runSourceCrawl, replayStrictSourceQualityEvidence} = await load(native, "src/crawler/runSourceCrawl.ts");
const {buildJobDedupeKey} = await load(native, "src/crawler/normalizedJob.ts");
const failure = read(failurePath), entry = failure.crawlResult.fetchEvidence.artifacts[0];
const request = read(path.join(probeDirectory, "request.json"));
const body = fs.readFileSync(path.join(probeDirectory, "response.private.json"), "utf8");
assert.equal(JSON.parse(body).refineSearch.data.jobs.length, 73);
let calls = 0, observedAt = failure.crawlResult.observation.crawledAt;
const oldFetch = globalThis.fetch;
globalThis.fetch = async () => {throw Error("OFFLINE_TEST_NETWORK_FORBIDDEN");};
try {
  const fetched = await createOfficialJsonSourceFetch({allowBrowserFallback: false, now: () => new Date(observedAt), http: async (r: any) => {
    assert(calls < 2, "No extra request is supported by this offline fixture");
    assert.equal(r.method, calls === 0 ? "GET" : "POST");
    assert.equal(r.url, calls === 0 ? nativePlan.source.officialEntryUrl : request.url);
    if (calls === 1) assert.deepEqual(JSON.parse(r.body), request.body);
    observedAt = calls === 0 ? entry.capturedAt : at;
    return calls++ === 0 ? {status: entry.httpStatus, body: entry.body, finalUrl: r.url, contentType: entry.contentType, capturedAt: entry.capturedAt}
      : {status: probe.httpStatus, body, finalUrl: r.url, contentType: probe.contentType, capturedAt: at};
  }})(nativePlan);
  const crawl = await runSourceCrawl(nativePlan, {fetch: async () => fetched});
  assert.equal(calls, 2); assert.equal(crawl.truth.completenessVerified, true); assert.equal(crawl.jobs.length, 73);
  assert.equal(replayStrictSourceQualityEvidence({plan: nativePlan, evidence: fetched.fetchEvidence, paginationEvaluation: fetched.paginationEvaluation,
    reconciliation: crawl.reconciliation, jobs: crawl.jobs, capturedAt: failure.crawlResult.observation.crawledAt}), true);
  const outcomes: any[] = [];
  for (const role of ["main", "fallback"]) {
    const root = path.join(candidatePackage, "vendor/reader-" + role);
    const mod = await load(root, "src/domain/portablePublicSnapshot.ts");
    const repo = await load(root, "src/db/portablePublicSnapshotRepository.ts");
    const reg = await load(root, "src/data/companyRegistry.ts");
    const plans = await load(root, "src/crawler/sourcePlan.ts");
    const quality = await load(root, "src/crawler/sourceQualityAdmission.ts");
    const mapper = await load(root, "src/db/prismaMappers.ts");
    const delta = await load(root, "src/domain/jobProjectionDeltaReceipt.ts");
    const plan = plans.buildStagedSourceCrawlPlans(reg.candidateCompanies).find((p: any) => p.source.id === SOURCE);
    assert.deepEqual(plan, nativePlan); assert.equal(quality.getSourceQualityPolicy(plan), "PLAN_BOUND_SOURCE_QUALITY_V1");
    assert.deepEqual(mod.portableCommittedConfigHashes(plan), [CURRENT, OLD]);
    const historicalPlan = structuredClone(plan); historicalPlan.officialJsonFetch.pageSize = 50;
    assert.equal(plans.sourcePlanConfigSha256(historicalPlan), OLD); assert.equal(quality.getSourceQualityPolicy(historicalPlan), null);
    const drift = structuredClone(plan); drift.officialJsonFetch.maxPages++;
    assert.equal(mod.portableCommittedConfigHashes(drift).includes(OLD), false);
    assert.equal(quality.getSourceQualityPolicy(drift), null);
    for (const other of plans.buildStagedSourceCrawlPlans(reg.candidateCompanies).filter((p: any) => p.source.id !== SOURCE)) {
      assert.deepEqual(mod.portableCommittedConfigHashes(other), [plans.sourcePlanConfigSha256(other)]);
    }
    const data = revive(rawBefore, mapper.toPrismaJobCategory);
    const project = (d: any) => {
      const selected = mod.selectPortableSourceSnapshots([plan], d.results, {currentTime: now})[0];
      return mod.projectPortableSourceJobs(selected, d.members.filter((m: any) => m.sourceResultId === selected.selectedSourceResultId), d.jobs, {currentTime: now}, d.members);
    };
    // Same scalar OR shape as the existing offline adapter; this shim actually applies it.
    const readRepository = async (d: any) => {
      const tx = {crawlBatchSourceResult: {findMany: async (args: any) => {
        assert.deepEqual(args.where.OR, [{sourceId: SOURCE, sourceConfigHash: CURRENT}, {sourceId: SOURCE, sourceConfigHash: OLD}]);
        return d.results.filter((r: any) => r.batch.kind === args.where.batch.is.kind && args.where.OR.some((p: any) => p.sourceId === r.sourceId && p.sourceConfigHash === r.sourceConfigHash));
      }}, lifecycleSetEvidenceMember: {findMany: async (args: any) => d.members.filter((m: any) => args.where.sourceResultId.in.includes(m.sourceResultId))},
      job: {findMany: async (args: any) => d.jobs.filter((j: any) => args.where.OR.some((p: any) => p.companyId === j.companyId && p.sourceId === j.sourceId &&
        p.lifecycleStatus === j.lifecycleStatus && p.visibleInFrontend === j.visibleInFrontend && p.dedupeKey.in.includes(j.dedupeKey) &&
        (!p.lastSeenAt || j.lastSeenAt >= p.lastSeenAt.gte && j.lastSeenAt <= p.lastSeenAt.lte)))}};
      const snapshot = await repo.readPortablePublicSnapshot({$transaction: async (work: any, opts: any) => {
        assert.equal(opts.isolationLevel, "RepeatableRead"); return work(tx);
      }}, {currentTime: now}, [plan]);
      return snapshot.sources.find((s: any) => s.sourceId === SOURCE);
    };
    const sql = repo.portableCommittedResultsSql([plan]);
    for (const hash of [CURRENT, OLD]) assert.equal(sql.split(`r."sourceConfigHash"='${hash}'`).length - 1, 2, "Both outer history and latest-candidate SQL must admit the exact hash");
    assert(!sql.includes("0".repeat(64)));
    const before = project(data); assert.equal(before.state, "PUBLISHING"); assert.equal(before.visibleJobCount, 72);
    assert.deepEqual(await readRepository(data), before);
    const originalRoot = path.join(originalPackage, "vendor/reader-" + role);
    const oldMod = await load(originalRoot, "src/domain/portablePublicSnapshot.ts");
    const oldPlans = await load(originalRoot, "src/crawler/sourcePlan.ts");
    const oldReg = await load(originalRoot, "src/data/companyRegistry.ts");
    const oldPlan = oldPlans.buildStagedSourceCrawlPlans(oldReg.candidateCompanies).find((p: any) => p.source.id === SOURCE);
    const oldSelection = oldMod.selectPortableSourceSnapshots([oldPlan], data.results, {currentTime: now})[0];
    const oldProjection = oldMod.projectPortableSourceJobs(oldSelection, data.members.filter((m: any) => m.sourceResultId === oldSelection.selectedSourceResultId), data.jobs, {currentTime: now}, data.members);
    assert.deepEqual({...before, currentConfigSha256: OLD}, oldProjection, "Only current plan identity changes for the real accepted 72-job snapshot");
    const synthetic = accepted(at, crawl.jobs.map((j: any) => j.sourceJobId), [], plan);
    const jobs = crawl.jobs.map((j: any) => ({id: "synthetic-" + j.sourceJobId, companyId: j.companyId, sourceId: j.sourceId,
      dedupeKey: buildJobDedupeKey(j), sourceJobId: j.sourceJobId, listUrl: j.listUrl, officialTitle: j.officialTitle,
      auxiliaryChineseTitle: null, humanCorrectedTitle: null, officialUrl: j.officialUrl, officialPublishedAt: dt(j.officialPublishedAt),
      city: j.cities[0], cities: j.cities, locationRaw: j.locationRaw, category: mapper.toPrismaJobCategory(j.category), humanCorrectedCategory: null,
      isNew: false, lastSeenAt: new Date(at), lifecycleStatus: "ACTIVE", visibleInFrontend: true, missingSuccessCount: 0}));
    const afterData = {results: [...data.results, synthetic.result], members: [...data.members, ...synthetic.members], jobs};
    const after = project(afterData); assert.equal(after.state, "PUBLISHING"); assert.equal(after.visibleJobCount, 73);
    assert.equal(after.selectedSourceResultId, synthetic.result.id); assert.deepEqual(await readRepository(afterData), after);
    assert.deepEqual(after.jobs.map((j: any) => j.officialUrl).sort(), crawl.jobs.map((j: any) => j.officialUrl).sort());
    for (const j of after.jobs) {
      const normalized = crawl.jobs.find((x: any) => x.officialUrl === j.officialUrl);
      assert.equal(j.officialTitle, normalized.officialTitle); assert.equal(j.officialPublishedAt, normalized.officialPublishedAt);
      assert.equal(j.locationRaw, normalized.locationRaw); assert.deepEqual(j.cities, normalized.cities);
    }
    const unknown = structuredClone(synthetic.result); unknown.sourceConfigHash = "0".repeat(64);
    assert.equal(project({results: [unknown], members: synthetic.members, jobs}).state, "HOLD");
    assert.equal((await readRepository({results: [unknown], members: synthetic.members, jobs})).state, "HOLD");
    const uncommitted = structuredClone(synthetic.result); uncommitted.atomicCommitState = "NOT_ATTEMPTED";
    assert.equal(project({results: [uncommitted], members: synthetic.members, jobs}).state, "HOLD");
    const failed = {...uncommitted, completenessState: "FAILED", transportState: "FAILED", completenessCertificate: null, failureCode: "FETCH_FAILED", dedupeOutputCount: 0};
    assert.equal(project({...data, results: [...data.results, failed]}).visibleJobCount, 72);
    assert.equal(project({...afterData, members: afterData.members.slice(0, -1)}).state, "HOLD");
    const future = structuredClone(synthetic.result); future.finishedAt = new Date(now.getTime() + 1);
    assert.equal(project({...afterData, results: [future]}).state, "HOLD");
    // A new delta's one-miss GRACE sighting must still verify the exact old CURRENT set and original times.
    const oldResult = data.results.find((r: any) => r.id === before.selectedSourceResultId);
    const visibleKeys = new Set(data.members.filter((m: any) => m.sourceResultId === oldResult.id && m.setKind === "CURRENT").map((m: any) => m.jobKey));
    const priorJobs = data.jobs.filter((j: any) => visibleKeys.has(j.dedupeKey));
    assert.equal(priorJobs.length, 72);
    const graceKey = priorJobs[0].sourceJobId;
    const graceFixture = accepted(at, priorJobs.slice(1).map((j: any) => j.sourceJobId), [graceKey], plan);
    const graceJobs = priorJobs.map((j: any, i: number) => ({...j, missingSuccessCount: i === 0 ? 1 : 0, lastSeenAt: i === 0 ? j.lastSeenAt : new Date(at)}));
    const priorReceipt = oldResult.completenessCertificate;
    const deltaMembers = graceFixture.members.map((m: any) => ({...m, jobProjectionSha256: delta.hashJobPersistedProjection(graceJobs.find((j: any) => j.dedupeKey === m.jobKey)),
      lastPresentResultId: m.missingCount ? oldResult.id : graceFixture.result.id,
      lastConfirmedObservedAt: m.missingCount ? priorReceipt.observedAt : at,
      lifecycleLastSeenAt: m.missingCount ? priorReceipt.verifiedAt : at}));
    const {releaseCandidateId, batchId, sourceId, id: sourceResultId} = graceFixture.result;
    graceFixture.result.completenessCertificate = {schemaVersion: "job-projection-delta-receipt-v1", binding: {releaseCandidateId, batchId, sourceId, sourceResultId},
      observedAt: at, verifiedAt: at, legacyCertificate: graceFixture.receipt, members: deltaMembers};
    const graceData = {results: [...data.results, graceFixture.result], members: [...data.members, ...graceFixture.members], jobs: graceJobs};
    const grace = project(graceData); assert.equal(grace.state, "PUBLISHING"); assert.equal(grace.visibleJobCount, 72);
    assert.equal(grace.jobs.filter((j: any) => j.inGrace).length, 1); assert.deepEqual(await readRepository(graceData), grace);
    const originalGrace = grace.jobs.find((j: any) => j.inGrace);
    assert.equal(originalGrace.lastSeenAt, priorReceipt.verifiedAt); assert.equal(originalGrace.lastConfirmedObservedAt, priorReceipt.observedAt);
    assert.equal(project({...graceData, members: graceFixture.members}).state, "HOLD", "Missing historical CURRENT membership must still hold");
    outcomes.push({role, realOldCommittedJobs: before.visibleJobCount, syntheticNewProbeJobs: after.visibleJobCount,
      syntheticCrossConfigGraceJobs: grace.visibleJobCount, unknownHashRejected: true, issuerRejectsOldPlan: true,
      realOldProjectionPreserved: true, prismaAndDomainAgree: true, sqlHistoryAndLatestCandidatePairChecked: true,
      membershipAndTimeGatesPreserved: true, beforeJobs: before.jobs, afterJobs: after.jobs});
  }
  assert.deepEqual(outcomes[0].beforeJobs, outcomes[1].beforeJobs); assert.deepEqual(outcomes[0].afterJobs, outcomes[1].afterJobs);
  const report = {status: "PASS", classification: "OFFLINE_READER_COMPATIBILITY_REAL_OLD_SNAPSHOT_AND_SYNTHETIC_NEW_COMMIT",
    networkUsed: false, databaseWrites: false, admissionAttempt: false, productionJobsReleased: 0,
    newCommitIsSynthetic: true, retainedEntryAndProbeUsedOnlyForOfflineNormalization: true,
    outcomes: outcomes.map(({beforeJobs, afterJobs, ...outcome}) => outcome)};
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report));
} finally {globalThis.fetch = oldFetch;}
