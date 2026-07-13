import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  getCompanyPublicationSnapshotFromDb,
  type PublicationEligibilityDb,
  type PublicationEligibilityQuery,
  type PublicationEligibilitySourceResultRow
} from "../../src/db/publicationEligibilityRepository";

const plans = buildStagedSourceCrawlPlans(candidateCompanies);
const companyWithOnePlan = candidateCompanies.find((company) =>
  plans.filter((plan) => plan.company.id === company.id).length === 1
)!;
const plan = plans.find(({ company }) => company.id === companyWithOnePlan.id)!;
const configHash = sourcePlanConfigSha256(plan);
const RELEASE_CANDIDATE_ID = "phase1-current-release";

declare const prismaClientTypeProbe: PrismaClient;
if (false) {
  const readOnlyPublicationDb: PublicationEligibilityDb = prismaClientTypeProbe;
  void readOnlyPublicationDb;
}

function row(
  index: number,
  overrides: Partial<PublicationEligibilitySourceResultRow> = {}
): PublicationEligibilitySourceResultRow {
  const id = overrides.id ?? `result-${index}`;
  const sourceId = overrides.sourceId ?? plan.source.id;
  const sourceConfigHash = overrides.sourceConfigHash ?? configHash;
  const startedAt = overrides.startedAt ?? new Date(`2026-07-14T01:${String(index).padStart(2, "0")}:10.000Z`);
  const finishedAt = overrides.finishedAt === undefined
    ? new Date(`2026-07-14T01:${String(index).padStart(2, "0")}:30.000Z`)
    : overrides.finishedAt;
  const batchId = overrides.batchId ?? `batch-${index}`;
  const base: PublicationEligibilitySourceResultRow = {
    id,
    releaseCandidateId: RELEASE_CANDIDATE_ID,
    batchId,
    sourceId,
    sourceConfigHash,
    transportState: "SUCCEEDED",
    adapterState: "SUCCEEDED",
    completenessState: "VERIFIED",
    atomicCommitState: "COMMITTED",
    startedAt,
    finishedAt,
    dedupeOutputCount: 1,
    expectedJobCount: 1,
    officialEntryId: null,
    officialSurfaceIds: [],
    officialChannelIds: [],
    batch: {
      id: batchId,
      releaseCandidateId: RELEASE_CANDIDATE_ID,
      kind: "SCHEDULED",
      status: "SUCCESS",
      startedAt: new Date(`2026-07-14T01:${String(index).padStart(2, "0")}:00.000Z`),
      finishedAt
    },
    observations: [{
      id: `observation-${index}`,
      releaseCandidateId: RELEASE_CANDIDATE_ID,
      batchId,
      sourceResultId: id,
      sourceId,
      sourceConfigSha256: sourceConfigHash,
      crawledAt: finishedAt!,
      successful: true,
      transportSucceeded: true,
      adapterSucceeded: true,
      completenessVerified: true,
      atomicCommitSucceeded: true,
      structuredJobCount: 1,
      expectedJobCount: 1,
      completenessStatus: "VERIFIED",
      stableRequiredFields: ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"]
    }]
  };
  return { ...base, ...overrides };
}

function fakeDb(rows: PublicationEligibilitySourceResultRow[]) {
  const findMany = vi.fn(async (_query: PublicationEligibilityQuery) => rows);
  const db = new Proxy({ crawlBatchSourceResult: { findMany } }, {
    get(target, property, receiver) {
      if (property !== "crawlBatchSourceResult") throw new Error(`UNEXPECTED_DB_ACCESS:${String(property)}`);
      return Reflect.get(target, property, receiver);
    }
  }) as PublicationEligibilityDb;
  return { db, findMany };
}

function getSnapshot(db: PublicationEligibilityDb) {
  return getCompanyPublicationSnapshotFromDb(
    db,
    async () => ({ identity: { releaseCandidateId: RELEASE_CANDIDATE_ID } })
  );
}

describe("getCompanyPublicationSnapshotFromDb", () => {
  it("uses one batched source-result query and keeps the canonical 30+30 directory without rows", async () => {
    const { db, findMany } = fakeDb([]);
    const snapshot = await getSnapshot(db);

    expect(findMany).toHaveBeenCalledTimes(1);
    const query = findMany.mock.calls[0]![0];
    expect(query.where).toEqual({
      releaseCandidateId: RELEASE_CANDIDATE_ID,
      sourceId: { in: expect.arrayContaining(plans.map(({ source }) => source.id)) },
      batch: { is: {
        releaseCandidateId: RELEASE_CANDIDATE_ID,
        kind: { in: ["FULL_RELEASE", "SCHEDULED", "BASELINE"] }
      } }
    });
    expect(query.select).toMatchObject({ releaseCandidateId: true });
    expect(query.select.batch).toEqual({
      select: { id: true, releaseCandidateId: true, kind: true, status: true, startedAt: true, finishedAt: true }
    });
    expect(query.select.observations).toMatchObject({
      where: { releaseCandidateId: RELEASE_CANDIDATE_ID },
      select: { releaseCandidateId: true, batchId: true },
      orderBy: [{ crawledAt: "asc" }, { id: "asc" }],
      take: 2
    });
    expect(query.orderBy).toEqual([
      { batch: { startedAt: "asc" } },
      { batchId: "asc" },
      { startedAt: "asc" },
      { id: "asc" }
    ]);
    expect(snapshot.companies).toHaveLength(candidateCompanies.length);
    expect(snapshot.companies.filter(({ category }) => category === "FOREIGN_PHARMA")).toHaveLength(
      candidateCompanies.filter(({ category }) => category === "FOREIGN_PHARMA").length
    );
    expect(snapshot.companies.filter(({ category }) => category === "DOMESTIC_PHARMA")).toHaveLength(
      candidateCompanies.filter(({ category }) => category === "DOMESTIC_PHARMA").length
    );
    for (const excludedId of ["company-humanwell", "company-north-china-pharma"]) {
      expect(snapshot.companies.find(({ companyId }) => companyId === excludedId)).toMatchObject({
        state: "USER_AUTHORIZED_PHASE1_EXCLUSION",
        eligibleSourceIds: []
      });
    }
    expect(snapshot.countsByState).toEqual(snapshot.companies.reduce((counts, company) => ({
      ...counts,
      [company.state]: counts[company.state] + 1
    }), Object.fromEntries(Object.keys(snapshot.countsByState).map((state) => [state, 0])) as typeof snapshot.countsByState));
  });

  it("derives current plan hashes internally and qualifies an empty strict tuple after two successes", async () => {
    const { db } = fakeDb([row(1), row(2)]);
    const snapshot = await getSnapshot(db);
    expect(snapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)).toMatchObject({
      state: "PUBLISHING",
      health: "HEALTHY",
      stagedSourceIds: [plan.source.id],
      eligibleSourceIds: [plan.source.id]
    });
  });

  it("qualifies two current-release official partial refreshes without claiming completeness", async () => {
    const partialRows = [1, 2].map((index) => {
      const value = row(index, {
        completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: null,
        officialSurfaceIds: [plan.source.surfaceId!],
        officialChannelIds: plan.expectedChannels!.map(({ channelId }) => channelId)
      });
      value.observations = value.observations.map((observation) => ({
        ...observation,
        completenessVerified: false,
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: null
      }));
      return value;
    });
    const { db } = fakeDb(partialRows);
    const snapshot = await getSnapshot(db);
    expect(snapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)).toMatchObject({
      state: "PUBLISHING",
      health: "HEALTHY",
      eligibleSourceIds: [plan.source.id]
    });
  });

  it("does not erase a terminal failure with zero observations from adjacency", async () => {
    const failure = row(2, {
      transportState: "FAILED",
      adapterState: "SKIPPED",
      completenessState: "FAILED",
      atomicCommitState: "NOT_ATTEMPTED",
      observations: []
    });
    const { db } = fakeDb([row(1), failure, row(3)]);
    const snapshot = await getSnapshot(db);
    expect(snapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)).toMatchObject({
      state: "VERIFYING",
      eligibleSourceIds: []
    });
  });

  it("maps batch completion facts so RUNNING sources wait and terminal missing-finish rows break", async () => {
    const runningOne = row(1);
    runningOne.batch = { ...runningOne.batch, status: "RUNNING", finishedAt: null };
    const runningTwo = row(2);
    runningTwo.batch = { ...runningTwo.batch, status: "RUNNING", finishedAt: null };
    const runningSnapshot = await getSnapshot(fakeDb([runningOne, runningTwo]).db);
    expect(runningSnapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)?.state).toBe("VERIFYING");

    const missingBatchFinish = row(2);
    missingBatchFinish.batch = { ...missingBatchFinish.batch, status: "SUCCESS", finishedAt: null };
    const terminalSnapshot = await getSnapshot(fakeDb([
      row(1),
      missingBatchFinish,
      row(3)
    ]).db);
    expect(terminalSnapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)?.state).toBe("VERIFYING");
  });

  it("ignores extra unplanned source rows without changing the canonical directory", async () => {
    const extra = row(1, { sourceId: "source-not-planned" });
    extra.observations = extra.observations.map((observation) => ({
      ...observation,
      sourceId: "source-not-planned"
    }));
    const { db } = fakeDb([extra]);
    const snapshot = await getSnapshot(db);
    expect(snapshot.companies).toHaveLength(candidateCompanies.length);
    expect(snapshot.eligibleSourceIds).not.toContain("source-not-planned");
  });

  it("fails closed for config mismatch or multiple observations", async () => {
    const mismatch = row(1, { sourceConfigHash: "f".repeat(64) });
    mismatch.observations = mismatch.observations.map((observation) => ({
      ...observation,
      sourceConfigSha256: mismatch.sourceConfigHash
    }));
    const two = row(2);
    two.observations = [two.observations[0]!, { ...two.observations[0]!, id: "observation-extra" }];
    const { db } = fakeDb([mismatch, two]);
    const snapshot = await getSnapshot(db);
    expect(snapshot.companies.find(({ companyId }) => companyId === companyWithOnePlan.id)?.state).toBe("VERIFYING");
  });

  it("rejects a batch relation tuple drift", async () => {
    const drift = row(1);
    drift.batch = { ...drift.batch, id: "different-batch" };
    const { db } = fakeDb([drift]);
    await expect(getSnapshot(db)).rejects.toThrow(/PUBLICATION_BATCH_RELATION_TUPLE_DRIFT/);
  });

  it("rejects source-result and observation rows from another release candidate", async () => {
    const resultDrift = row(1, { releaseCandidateId: "old-release" });
    await expect(getSnapshot(fakeDb([resultDrift]).db)).rejects.toThrow(
      /PUBLICATION_BATCH_RELATION_TUPLE_DRIFT/
    );

    const observationDrift = row(2);
    observationDrift.observations = observationDrift.observations.map((observation) => ({
      ...observation,
      releaseCandidateId: "old-release"
    }));
    await expect(getSnapshot(fakeDb([observationDrift]).db)).rejects.toThrow(
      /PUBLICATION_OBSERVATION_RELATION_TUPLE_DRIFT/
    );
  });
});
