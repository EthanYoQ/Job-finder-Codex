// @vitest-environment node
import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { toPrismaJobCategory } from "../../src/db/prismaMappers";
import { readPortablePublicSnapshotWithStatus, type PortableSnapshotDb, type PortableSnapshotTransactionDb } from "../../src/db/portablePublicSnapshotRepository";
import type { JobCategory } from "../../src/domain/search";

// Exact wire output of the paired publisher's actual compiler and in-memory SQL.
// Its core-SHA adapter is explicitly test-only; this is not PG16 acceptance.
const packet = JSON.parse(readFileSync(new NodeURL("../fixtures/publisher-generated-delta-fixtures.json", import.meta.url), "utf8"));
type Wire = {label: string; sourceId: string; currentTime: string; sources: any[]; members: any[]; jobs: any[]};
const fixtures = packet.fixtures as Wire[];
function dates(row: Record<string, any>, fields: string[]): void {
  for (const key of fields) if (row[key] !== null && row[key] !== undefined) {
    const text = String(row[key]); row[key] = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`);
  }
}
function hydrate(input: Wire) {
  const f = structuredClone(input);
  for (const row of f.sources) {
    dates(row, ["startedAt", "finishedAt", "createdAt"]);
    dates(row.batch, ["startedAt", "finishedAt"]);
    for (const observation of row.observations) dates(observation, ["observedFrom", "observedTo", "crawledAt"]);
  }
  for (const row of f.jobs) {
    dates(row, ["lastSeenAt", "firstSeenAt", "officialPublishedAt", "sourceChangedAt"]);
    row.category = toPrismaJobCategory(row.category as JobCategory);
    if (row.humanCorrectedCategory !== null) row.humanCorrectedCategory = toPrismaJobCategory(row.humanCorrectedCategory as JobCategory);
  }
  return f;
}
async function read(input: Wire, prior = false) {
  const f = hydrate(input);
  if (prior) {
    const first = f.sources[0]!;
    f.sources = [first]; f.members = f.members.filter(row => row.sourceResultId === first.id);
  }
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(row => row.source.id === f.sourceId)!;
  const tx = {crawlBatchSourceResult: {findMany: async () => f.sources},
    lifecycleSetEvidenceMember: {findMany: async (query: any) => f.members.filter(row => query.where.sourceResultId.in.includes(row.sourceResultId))},
    job: {findMany: async () => f.jobs}};
  const db = {$transaction: async (run: (tx: PortableSnapshotTransactionDb) => unknown) => run(tx)} as PortableSnapshotDb;
  return readPortablePublicSnapshotWithStatus(db, {currentTime: new Date(f.currentTime)}, [plan]);
}
describe("actual paired publisher wire into the portable reader", () => {
  it("identifies the local-only SQL/crypto qualification boundary", () => {
    expect(packet.syntheticOnly).toBe(true);
    expect(packet.implementation).toBe("actual compiler and in-memory SQL");
    expect(packet.cryptoMode).toBe("TEST_ONLY_CORE_SHA256_ADAPTER");
  });
  it.each(fixtures)("verifies $label without repairing the publisher's receipt", async f => {
    const before = JSON.stringify(f), result = await read(f), source = result.snapshot.sources[0]!;
    const memberKeys = new Set(f.members.filter(row => row.sourceResultId === source.selectedSourceResultId && row.setKind === "VISIBLE").map(row => row.jobKey));
    const visible = f.jobs.filter(row => memberKeys.has(row.dedupeKey) && row.lifecycleStatus === "ACTIVE" && row.visibleInFrontend);
    expect(source, f.label).toMatchObject({state: "PUBLISHING", visibleJobCount: visible.length});
    expect(source.jobs.map(row => row.id).sort()).toEqual(visible.map(row => row.id).sort());
    for (const row of source.jobs) {
      const stored = visible.find(job => job.id === row.id)!;
      expect(row.officialTitle).toBe(stored.officialTitle);
      expect(row.title).toBe(stored.humanCorrectedTitle || stored.auxiliaryChineseTitle || stored.officialTitle);
      expect(row.inGrace).toBe(stored.missingSuccessCount === 1);
      expect(row.lastConfirmedObservedAt).toEqual(expect.any(String));
    }
    expect(result.snapshotRefresh.state).toBe("CURRENT");
    expect(JSON.stringify(f)).toBe(before);
  });
  it.each(fixtures.filter(f => f.label.startsWith("complete-miss-")))("ignores unadmitted legacy ACTIVE and historical OFFLINE rows in $label", async f => {
    const first = fixtures.find(row => row.label === "complete-miss-1")!;
    const legacy = f.jobs.find(row => row.id === "synthetic-legacy-before-floor")!;
    const offline = f.jobs.find(row => row.id === "synthetic-historical-offline")!;
    expect(legacy).toEqual(first.jobs.find(row => row.id === "synthetic-legacy-before-floor"));
    expect(legacy).toMatchObject({lifecycleStatus: "ACTIVE", visibleInFrontend: true, missingSuccessCount: 0, sourceChangedAt: null});
    expect(String(legacy.lastSeenAt)).toBe("2020-01-01T00:00:00");
    expect(offline).toMatchObject({lifecycleStatus: "OFFLINE", visibleInFrontend: false, missingSuccessCount: 6 + Number(f.label.at(-1))});
    expect(f.members.some(row => row.jobKey === legacy.dedupeKey || row.jobKey === offline.dedupeKey)).toBe(false);
    const result = await read(f);
    expect(result.snapshot.sources[0]!.jobs.some(row => row.id === legacy.id || row.id === offline.id)).toBe(false);
  });

  it("keeps data identity across the actual second no-op round while preserving physical lastSeenAt", async () => {
    const f = fixtures.find(row => row.label === "second-unchanged-v2")!, previous = await read(f, true), current = await read(f);
    expect(current.snapshotRefresh.displayDataVersion).toBe(previous.snapshotRefresh.displayDataVersion);
    expect(current.snapshotRefresh.statusVersion).not.toBe(previous.snapshotRefresh.statusVersion);
    const originalPhysical = String(f.jobs[0].lastSeenAt).replace(/Z$/, "");
    expect(current.snapshot.sources[0]!.jobs[0]!.lastSeenAt.replace(/Z$/, "")).not.toBe(originalPhysical);
    expect(previous.snapshot.sources[0]!.jobs[0]!.lastSeenAt.replace(/Z$/, "")).toBe(originalPhysical);
  });
});
