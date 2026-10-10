import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readPortablePublicSnapshot, type PortableSnapshotDb, type PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import { accepted, failed, job, plan, NOW, FIRST } from "../helpers/portablePublicSnapshotFixture";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { P0_LAUNCH_MANIFEST, selectLaunchCompanies } from "../../src/release/launchManifest";
import { candidateCompanies } from "../../src/data/companyRegistry";

declare const prisma: PrismaClient;
if (false) {
  const db: PortableSnapshotDb = prisma;
  const tx: PortableSnapshotTransactionDb = prisma;
  void db; void tx;
}
function fixture(rows = [accepted().result], members = accepted().members, jobs = [job()]) {
  const events: string[] = [];
  const tx = {
    crawlBatchSourceResult: {findMany: vi.fn(async () => {events.push("RESULTS"); return rows;})},
    lifecycleSetEvidenceMember: {findMany: vi.fn(async () => {events.push("MEMBERS"); return members;})},
    job: {findMany: vi.fn(async () => {events.push("JOBS"); return jobs;})}
  };
  const transaction = vi.fn(async (work: (db: PortableSnapshotTransactionDb) => Promise<unknown>) => {
    events.push("BEGIN"); const result = await work(tx); events.push("END"); return result;
  });
  return {db: {$transaction: transaction} as PortableSnapshotDb, tx, transaction, events};
}
const read = (db: PortableSnapshotDb) => readPortablePublicSnapshot(db, {currentTime: NOW}, [plan]);
describe("portable public snapshot repository", () => {
  it("uses one repeatable-read transaction for receipts, membership and current rows", async () => {
    const f = fixture(); const snapshot = await read(f.db);
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000});
    expect(f.events).toEqual(["BEGIN", "RESULTS", "MEMBERS", "JOBS", "END"]);
    expect(snapshot).toMatchObject({schemaVersion: "portable-public-snapshot-v1", totalJobs: 1, lastUpdatedAt: FIRST, coverage: {companyCount: 41, expectedSourceCount: 41, sourceCount: 1, unplannedSourceCount: 40, publishingSourceCount: 1, unsupportedSourceCount: 0, heldSourceCount: 0}});
    expect(snapshot.companies.filter(company => company.category === "FOREIGN_PHARMA")).toHaveLength(30);
    expect(snapshot.companies.filter(company => company.category === "DOMESTIC_PHARMA")).toHaveLength(11);
    expect(snapshot.companies.find(company => company.id === plan.company.id)).toMatchObject({coverage: "COMPLETE", health: "HEALTHY", jobs: [{id: "job-1"}]});
    expect(JSON.stringify(snapshot)).not.toMatch(/completenessCertificate|adapterVersion|rawCount|failureReason|selected":/);
  });
  it("loads exact current-config scheduled history, then restricts jobs to membership and floor/ceiling", async () => {
    const f = fixture(); await read(f.db);
    expect(f.tx.crawlBatchSourceResult.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {
      OR: [{sourceId: plan.source.id, sourceConfigHash: accepted().result.sourceConfigHash}], batch: {is: {kind: "SCHEDULED"}}
    }}));
    expect(f.tx.lifecycleSetEvidenceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {sourceResultId: {in: [accepted().result.id]}}}));
    expect(f.tx.job.findMany).toHaveBeenCalledWith(expect.objectContaining({where: {OR: [{companyId: plan.company.id, sourceId: plan.source.id,
      lifecycleStatus: "ACTIVE", visibleInFrontend: true, lastSeenAt: {gte: new Date(FIRST), lte: new Date(FIRST)}, dedupeKey: {in: [job().dedupeKey]}}]}}));
  });
  it("does not use empty job queries as evidence for failed or unknown sources", async () => {
    const f = fixture([failed()], [], []); const snapshot = await read(f.db);
    expect(f.tx.job.findMany).not.toHaveBeenCalled(); expect(f.tx.lifecycleSetEvidenceMember.findMany).not.toHaveBeenCalled();
    expect(snapshot.sources[0]).toMatchObject({state: "HOLD", lastAcceptedJobCount: null, visibleJobCount: null});
    expect(snapshot).toMatchObject({totalJobs: 0, lastUpdatedAt: null, coverage: {heldSourceCount: 1}});
  });
  it("shows a verified empty source without claiming unverified companies have zero jobs", async () => {
    const f = fixture([accepted(FIRST, []).result], [], []); const snapshot = await read(f.db);
    expect(snapshot.sources[0]).toMatchObject({state: "PUBLISHING", lastAcceptedJobCount: 0, visibleJobCount: 0});
    expect(snapshot.companies.filter(company => company.coverage === "UNVERIFIED")).toHaveLength(39);
  });
  it("keeps failed-attempt zero and diagnostic rows from replacing the accepted count", async () => {
    const manual = accepted("2026-10-01T11:30:00.000Z", []); manual.result.batch.kind = "MANUAL_SOURCE";
    const f = fixture([accepted().result, failed(), manual.result]); const snapshot = await read(f.db);
    expect(snapshot.sources[0]).toMatchObject({state: "PUBLISHING", health: "DEGRADED", lastAcceptedJobCount: 1, visibleJobCount: 1});
  });
  it("turns missing mutable rows into an integrity hold rather than verified zero", async () => {
    const f = fixture([accepted().result], accepted().members, []); const snapshot = await read(f.db);
    expect(snapshot.sources[0]).toMatchObject({state: "HOLD", health: "DEGRADED", lastAcceptedJobCount: 1, visibleJobCount: null, reasons: ["PROJECTION_INTEGRITY_HOLD"]});
    expect(snapshot.lastUpdatedAt).toBeNull();
  });
  it("keeps all 41 companies without treating a registered policy as an accepted receipt", async () => {
    const f = fixture([], [], []); const snapshot = await readPortablePublicSnapshot(f.db, {currentTime: NOW});
    expect(snapshot.companies).toHaveLength(41);
    expect(snapshot.coverage.sourceCount).toBe(buildStagedSourceCrawlPlans(selectLaunchCompanies(P0_LAUNCH_MANIFEST, candidateCompanies)).length);
    expect(snapshot.coverage.publishingSourceCount).toBe(0);
    expect(snapshot.sources.filter(source => source.state === "HOLD")).toHaveLength(40);
    expect(snapshot.sources.filter(source => ["source-pfizer-china-social", "source-bayer-healthcare-social"].includes(source.sourceId))).toEqual(expect.arrayContaining([
      expect.objectContaining({sourceId: "source-pfizer-china-social", state: "HOLD", policyId: "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2"}),
      expect.objectContaining({sourceId: "source-bayer-healthcare-social", state: "HOLD", policyId: "STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2"})
    ]));
  });
  it("freezes plan and row selections across awaited reads", async () => {
    const callerPlan = structuredClone(plan); const row = accepted().result; const f = fixture([row]);
    f.tx.lifecycleSetEvidenceMember.findMany.mockImplementation(async () => {
      callerPlan.source.officialEntryUrl += "?mutated=1";
      row.canonicalVisibleJobSetSha256 = "f".repeat(64);
      return accepted().members;
    });
    const snapshot = await readPortablePublicSnapshot(f.db, {currentTime: NOW}, [callerPlan]);
    expect(snapshot.sources[0]).toMatchObject({state: "PUBLISHING", visibleJobCount: 1});
  });
  it("never reads without a repeatable-read transaction and rejects relaxed freshness", async () => {
    await expect(read({} as PortableSnapshotDb)).rejects.toThrow("REPEATABLE_READ_PORTABLE_SNAPSHOT_REQUIRED");
    const f = fixture();
    await expect(readPortablePublicSnapshot(f.db, {currentTime: NOW, freshnessMaximumMs: 31 * 60 * 60 * 1000}, [plan])).rejects.toThrow("INVALID_PORTABLE_PUBLICATION_FRESHNESS");
    expect(f.transaction).not.toHaveBeenCalled();
  });
});

describe("current required40 scope", () => {
  it("returns explicit excluded status for United Lab without reading or claiming zero", async () => {
    const f = fixture([], [], []); const snapshot = await readPortablePublicSnapshot(f.db, {currentTime: NOW});
    expect(snapshot.coverage).toMatchObject({companyCount: 41, requiredCompanyCount: 40, excludedCompanyCount: 1, requiredSourceCount: 40, excludedSourceCount: 1});
    expect(snapshot.companies.find(company => company.id === "company-united-lab")).toMatchObject({required: false, coverage: "EXCLUDED", health: "NOT_APPLICABLE", exclusionReason: "USER_AUTHORIZED_EXCLUSION", jobs: []});
    expect(snapshot.sources.find(source => source.sourceId === "source-united-lab-social")).toMatchObject({state: "EXCLUDED", health: "NOT_APPLICABLE", reasons: ["USER_AUTHORIZED_EXCLUSION"], lastAcceptedJobCount: null, visibleJobCount: null});
    expect(JSON.stringify(f.tx.crawlBatchSourceResult.findMany.mock.calls)).not.toContain("source-united-lab-social");
  });
});

it("allows only the exact registered B adapter transition within the historical roster", async () => {
  const current = buildStagedSourceCrawlPlans(candidateCompanies).find(plan => plan.source.id === "source-bayer-healthcare-social")!;
  const db = fixture([], [], []).db;
  expect((await readPortablePublicSnapshot(db, {currentTime: NOW}, [current])).sources[0]?.state).toBe("HOLD");
  const changed = structuredClone(current); changed.source.officialEntryUrl += "?unreviewed";
  await expect(readPortablePublicSnapshot(db, {currentTime: NOW}, [changed])).rejects.toThrow("PORTABLE_PLAN_OUTSIDE_ROSTER");
});
