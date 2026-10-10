import { describe, expect, it, vi } from "vitest";
import { createPrismaCrawlRuntimeDeps } from "../../src/db/crawlRuntimeRepository";
import { accepted, digest, plan } from "../helpers/portablePublicSnapshotFixture";
import { sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import type {
  PersistedCrawlObservationRow,
  PersistedJobRow
} from "../../src/db/crawlStateRepository";

const fakeJobRows: PersistedJobRow[] = [
  {
    dedupeKey: "source-test-social:job-1",
    companyId: "company-test",
    sourceId: "source-test-social",
    sourceJobId: "job-1",
    officialTitle: "医学信息沟通专员",
    auxiliaryChineseTitle: null,
    officialUrl: "https://example.com/jobs/job-1",
    listUrl: null,
    locationRaw: "北京",
    city: "北京",
    cities: ["北京"],
    category: "SALES",
    officialPublishedAt: null,
    firstSeenAt: new Date("2026-07-07T08:00:00.000Z"),
    lastSeenAt: new Date("2026-07-08T08:00:00.000Z"),
    missingSuccessCount: 0,
    lifecycleStatus: "ACTIVE",
    source: {
      atsKind: "MOKA",
      kind: "SOCIAL",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
    },
    company: {
      officialChineseName: "测试药企"
    }
  }
];

const fakeCrawlObservations: PersistedCrawlObservationRow[] = [
  {
    crawledAt: new Date("2026-07-08T20:00:00.000Z"),
    successful: false
  },
  {
    crawledAt: new Date("2026-07-08T08:00:00.000Z"),
    successful: true
  }
];

function fakeDb() {
  return {
    job: {
      findMany: vi.fn(async () => fakeJobRows)
    },
    crawlObservation: {
      findMany: vi.fn(async () => fakeCrawlObservations),
      findFirst: vi.fn(async () => ({ id: "crawl-1" }))
    },
    crawlBatchSourceResult: {
      findFirst: vi.fn(async () => ({
        id: "verified-source-result-1",
        sourceId: "source-test-social",
        sourceConfigHash: "a".repeat(64),
        dedupeOutputCount: 50,
        completenessCertificate: { grade: "B" },
        completenessCertificateSha256: "b".repeat(64),
        finishedAt: new Date("2026-07-08T08:00:00.000Z"),
        baselinePreviousSourceResultId: null,
        baselinePreviousJobCount: null,
        baselineChangeReason: "INDEPENDENT_VALIDATION_CONFIRMED_INITIAL"
      }))
    }
  };
}

describe("createPrismaCrawlRuntimeDeps", () => {
  function portableRow() {
    return {...accepted().result,baselinePreviousSourceResultId:null,baselinePreviousJobCount:null,
      baselineChangeReason:"PLAN_BOUND_REPLAY_CONFIRMED_INITIAL"};
  }
  it("excludes an old configuration before validating its obsolete portable receipt", async () => {
    const old=portableRow();old.sourceConfigHash="0".repeat(64);
    const receipt=structuredClone(old.completenessCertificate) as any;
    receipt.binding.sourceConfigSha256=old.sourceConfigHash;
    old.completenessCertificate=receipt;old.completenessCertificateSha256=digest(receipt);
    const db=fakeDb();
    db.crawlBatchSourceResult.findFirst=vi.fn(async (args:any)=>args.where.sourceConfigHash===sourcePlanConfigSha256(plan)?null:old) as any;
    const deps=createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan]});
    await expect(deps.getTrustedCompletenessBaseline(plan.source.id)).resolves.toBeNull();
  });
  it("still validates and retains a current-policy portable baseline", async () => {
    const db=fakeDb();db.crawlBatchSourceResult.findFirst.mockResolvedValueOnce(portableRow() as never);
    const deps=createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan]});
    await expect(deps.getTrustedCompletenessBaseline(plan.source.id)).resolves.toMatchObject({
      sourceConfigSha256:sourcePlanConfigSha256(plan),certificateGrade:"PLAN_BOUND_SOURCE_QUALITY_V1",certifiedJobCount:1});
    expect(db.crawlBatchSourceResult.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({
      sourceId:plan.source.id,sourceConfigHash:sourcePlanConfigSha256(plan),
      completenessCertificate:{path:["schemaVersion"],equals:"plan-bound-source-quality-v1"}})}));
  });
  it("rejects malformed receipts from the current configuration", async () => {
    const row=portableRow();row.completenessCertificateSha256="0".repeat(64);
    const db=fakeDb();db.crawlBatchSourceResult.findFirst.mockResolvedValueOnce(row as never);
    await expect(createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan]}).getTrustedCompletenessBaseline(plan.source.id)).rejects.toThrow("SOURCE_QUALITY_RECEIPT_BINDING_INVALID");
  });
  it("rejects a repository row outside the requested portable source/configuration", async () => {
    const row=portableRow();row.sourceId="other-source";
    const db=fakeDb();db.crawlBatchSourceResult.findFirst.mockResolvedValueOnce(row as never);
    await expect(createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan]}).getTrustedCompletenessBaseline(plan.source.id)).rejects.toThrow();
  });
  it("fails closed when portable baseline lookup has no current source plan", async () => {
    const db=fakeDb();
    await expect(createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan]}).getTrustedCompletenessBaseline("missing-source")).rejects.toThrow("PORTABLE_BASELINE_CURRENT_PLAN_REQUIRED");
    expect(db.crawlBatchSourceResult.findFirst).not.toHaveBeenCalled();
  });
  it("reads previous jobs, recent observations, and baseline status for a source", async () => {
    const db = fakeDb();
    const deps = createPrismaCrawlRuntimeDeps(db);

    const previousJobs = await deps.getPreviousJobs("source-test-social");
    const observations = await deps.getRecentObservations("source-test-social");
    const trustedBaseline = await deps.getTrustedCompletenessBaseline("source-test-social");
    const baselineCompleted = await deps.isBaselineCompleted("source-test-social");

    expect(db.job.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social" },
      include: {
        source: {
          select: {
            atsKind: true,
            kind: true,
            status: true,
            officialEntryUrl: true,
            officialChainEvidenceUrl: true
          }
        },
        company: {
          select: {
            officialChineseName: true
          }
        }
      },
      orderBy: { lastSeenAt: "desc" }
    });
    expect(previousJobs[0]?.record.officialChineseCompanyName).toBe("测试药企");
    expect(previousJobs[0]?.record.category).toBe("销售");
    expect(db.crawlObservation.findMany).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social", batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
      select: { crawledAt: true, successful: true },
      orderBy: { crawledAt: "desc" },
      take: 10
    });
    expect(observations).toEqual([
      {
        crawledAt: new Date("2026-07-08T20:00:00.000Z"),
        successful: false
      },
      {
        crawledAt: new Date("2026-07-08T08:00:00.000Z"),
        successful: true
      }
    ]);
    expect(db.crawlBatchSourceResult.findFirst).toHaveBeenCalledWith({
      where: {
        sourceId: "source-test-social",
        completenessState: "VERIFIED",
        atomicCommitState: "COMMITTED",
        completenessCertificateSha256: { not: null },
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } }
      },
      select: {
        releaseCandidateId: true, batchId: true, adapterVersion: true,
        id: true,
        sourceId: true,
        sourceConfigHash: true,
        dedupeOutputCount: true,
        completenessCertificate: true,
        completenessCertificateSha256: true,
        finishedAt: true,
        baselinePreviousSourceResultId: true,
        baselinePreviousJobCount: true,
        baselineChangeReason: true
      },
      orderBy: { finishedAt: "desc" }
    });
    expect(trustedBaseline).toMatchObject({
      sourceResultId: "verified-source-result-1",
      certifiedJobCount: 50,
      certificateGrade: "B",
      changeReason: "INDEPENDENT_VALIDATION_CONFIRMED_INITIAL"
    });
    expect(db.crawlObservation.findFirst).toHaveBeenCalledWith({
      where: { sourceId: "source-test-social", successful: true,
        batch: { is: { kind: { not: "MANUAL_SOURCE" } } } },
      select: { id: true },
      orderBy: { crawledAt: "asc" }
    });
    expect(baselineCompleted).toBe(true);
  });

  it("keeps MANUAL_SOURCE preview history out of later FULL_RELEASE schedule and baseline inputs", async () => {
    const db = fakeDb();
    const deps = createPrismaCrawlRuntimeDeps(db);
    await deps.getRecentObservations("source-test-social");
    await deps.getTrustedCompletenessBaseline("source-test-social");
    await deps.isBaselineCompleted("source-test-social");

    expect(db.crawlObservation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batch: { is: { kind: { not: "MANUAL_SOURCE" } } } })
    }));
    expect(db.crawlBatchSourceResult.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batch: { is: { kind: { not: "MANUAL_SOURCE" } } } })
    }));
  });

  it("keeps an unverified anomaly from replacing the last trusted baseline", async () => {
    const db = fakeDb();
    db.crawlBatchSourceResult.findFirst.mockResolvedValueOnce(null as never);
    const deps = createPrismaCrawlRuntimeDeps(db);

    await expect(deps.getTrustedCompletenessBaseline("source-test-social")).resolves.toBeNull();
    expect(db.crawlBatchSourceResult.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        completenessState: "VERIFIED",
        atomicCommitState: "COMMITTED",
        completenessCertificateSha256: { not: null }
      })
    }));
  });
});
