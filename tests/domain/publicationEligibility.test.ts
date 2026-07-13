import { describe, expect, it } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  buildCompanyPublicationSnapshot,
  evaluateSourcePublicationEligibility,
  isQualifyingPublicationAttempt,
  type CurrentStagedPublicationSource,
  type PublicationAttempt,
  type PublicationAttemptObservation
} from "../../src/domain/publicationEligibility";

const CURRENT_CONFIG = "a".repeat(64);
const OTHER_CONFIG = "b".repeat(64);
const REQUIRED_FIELDS = ["COMPANY", "TITLE", "OFFICIAL_URL", "LOCATION"] as const;

function currentSource(
  sourceId = "source-test-social",
  companyId = "company-test"
): CurrentStagedPublicationSource {
  return { companyId, sourceId, currentConfigSha256: CURRENT_CONFIG };
}

type AttemptOverrides = Partial<Omit<PublicationAttempt, "observations">> & {
  observation?: Partial<PublicationAttemptObservation> | null;
  observations?: PublicationAttemptObservation[];
};

function attempt(index: number, overrides: AttemptOverrides = {}): PublicationAttempt {
  const id = overrides.id ?? `result-${index}`;
  const sourceId = overrides.sourceId ?? "source-test-social";
  const sourceConfigHash = overrides.sourceConfigHash ?? CURRENT_CONFIG;
  const base: Omit<PublicationAttempt, "observations"> = {
    id,
    batchId: `batch-${String(index).padStart(2, "0")}`,
    batchKind: "SCHEDULED",
    batchStatus: "SUCCESS",
    batchStartedAt: new Date(`2026-07-14T00:${String(index).padStart(2, "0")}:00.000Z`),
    batchFinishedAt: new Date(`2026-07-14T00:${String(index).padStart(2, "0")}:40.000Z`),
    sourceId,
    sourceStartedAt: new Date(`2026-07-14T00:${String(index).padStart(2, "0")}:10.000Z`),
    finishedAt: new Date(`2026-07-14T00:${String(index).padStart(2, "0")}:30.000Z`),
    sourceConfigHash,
    transportState: "SUCCEEDED",
    adapterState: "SUCCEEDED",
    completenessState: "VERIFIED",
    atomicCommitState: "COMMITTED",
    dedupeOutputCount: 2,
    expectedJobCount: 2,
    officialEntryId: null,
    officialSurfaceIds: [],
    officialChannelIds: []
  };
  const merged = { ...base, ...overrides };
  const defaultObservation: PublicationAttemptObservation = {
    id: `observation-${index}`,
    sourceResultId: merged.id,
    sourceId: merged.sourceId,
    sourceConfigSha256: merged.sourceConfigHash,
    crawledAt: merged.finishedAt ?? merged.sourceStartedAt,
    successful: true,
    transportSucceeded: true,
    adapterSucceeded: true,
    completenessVerified: true,
    atomicCommitSucceeded: true,
    structuredJobCount: merged.dedupeOutputCount,
    expectedJobCount: merged.expectedJobCount,
    completenessStatus: "VERIFIED",
    stableRequiredFields: REQUIRED_FIELDS
  };
  const observations = overrides.observations ?? (
    overrides.observation === null ? [] : [{ ...defaultObservation, ...overrides.observation }]
  );
  const { observation: _observation, ...withoutObservation } = merged;
  return { ...withoutObservation, observations };
}

function failedAttempt(index: number, overrides: AttemptOverrides = {}): PublicationAttempt {
  return attempt(index, {
    transportState: "FAILED",
    adapterState: "SKIPPED",
    completenessState: "FAILED",
    atomicCommitState: "NOT_ATTEMPTED",
    observation: null,
    ...overrides
  });
}

function company(overrides: Partial<CandidateCompany> = {}): CandidateCompany {
  return {
    id: "company-test",
    officialChineseName: "测试药企",
    pinyinName: "ceshi-yaoqi",
    category: "DOMESTIC_PHARMA",
    targetStatus: "ACTIVE",
    sources: [],
    officialWebsiteUrl: "https://example.test",
    ...overrides
  };
}

describe("publication attempt qualification", () => {
  it("allows the corrected empty strict-oracle tuple boundary", () => {
    expect(isQualifyingPublicationAttempt(attempt(1), currentSource())).toBe(true);
  });

  it("requires a terminal, finished batch without rejecting successful sources in mixed batches", () => {
    expect(isQualifyingPublicationAttempt(attempt(1, {
      batchStatus: "RUNNING",
      batchFinishedAt: null
    }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, {
      batchStatus: "SUCCESS",
      batchFinishedAt: null
    }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, { batchStatus: "FAILED" }), currentSource())).toBe(true);
    expect(isQualifyingPublicationAttempt(attempt(1, { batchStatus: "INCOMPLETE" }), currentSource())).toBe(true);
  });

  it.each([
    ["transport", { transportState: "FAILED" }],
    ["adapter", { adapterState: "FAILED" }],
    ["completeness", { completenessState: "INCOMPLETE" }],
    ["atomic commit", { atomicCommitState: "ROLLED_BACK" }],
    ["unfinished", { finishedAt: null }]
  ] as const)("fails closed for an invalid %s result", (_name, mutation) => {
    expect(isQualifyingPublicationAttempt(attempt(1, mutation), currentSource())).toBe(false);
  });

  it.each([
    ["successful", { successful: false }],
    ["transport", { transportSucceeded: null }],
    ["adapter", { adapterSucceeded: false }],
    ["completeness", { completenessVerified: null }],
    ["atomic commit", { atomicCommitSucceeded: false }],
    ["status", { completenessStatus: "INCOMPLETE" }]
  ] as const)("fails closed for an invalid observation %s field", (_name, mutation) => {
    expect(isQualifyingPublicationAttempt(attempt(1, { observation: mutation }), currentSource())).toBe(false);
  });

  it("requires exactly one observation bound to the result, source, and config", () => {
    expect(isQualifyingPublicationAttempt(attempt(1, { observation: null }), currentSource())).toBe(false);
    const first = attempt(1).observations[0]!;
    expect(isQualifyingPublicationAttempt(attempt(1, { observations: [first, { ...first, id: "second" }] }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, { observation: { sourceResultId: "wrong" } }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, { observation: { sourceId: "wrong" } }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, { observation: { sourceConfigSha256: OTHER_CONFIG } }), currentSource())).toBe(false);
  });

  it("reconciles positive counts and every required stable field", () => {
    expect(isQualifyingPublicationAttempt(attempt(1, {
      dedupeOutputCount: 3,
      expectedJobCount: 3,
      observation: { structuredJobCount: 2, expectedJobCount: 3 }
    }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, {
      expectedJobCount: 2,
      observation: { expectedJobCount: 3 }
    }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, {
      dedupeOutputCount: 2,
      expectedJobCount: 3,
      observation: { structuredJobCount: 2, expectedJobCount: 3 }
    }), currentSource())).toBe(false);
    for (const missing of REQUIRED_FIELDS) {
      expect(isQualifyingPublicationAttempt(attempt(1, {
        observation: { stableRequiredFields: REQUIRED_FIELDS.filter((field) => field !== missing) }
      }), currentSource())).toBe(false);
    }
  });

  it("accepts only exact 0/0/0 for an official zero-job result", () => {
    expect(isQualifyingPublicationAttempt(attempt(1, {
      dedupeOutputCount: 0,
      expectedJobCount: 0,
      observation: { structuredJobCount: 0, expectedJobCount: 0, stableRequiredFields: [] }
    }), currentSource())).toBe(true);
    expect(isQualifyingPublicationAttempt(attempt(1, {
      dedupeOutputCount: 0,
      expectedJobCount: null,
      observation: { structuredJobCount: 0, expectedJobCount: null, stableRequiredFields: [] }
    }), currentSource())).toBe(false);
    expect(isQualifyingPublicationAttempt(attempt(1, {
      dedupeOutputCount: 0,
      expectedJobCount: 1,
      observation: { structuredJobCount: 0, expectedJobCount: 1, stableRequiredFields: [] }
    }), currentSource())).toBe(false);
  });
});

describe("source publication sequence", () => {
  it("requires two adjacent qualifying completed attempts", () => {
    expect(evaluateSourcePublicationEligibility(currentSource(), []).hasQualifiedCurrentConfig).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1)]).hasQualifiedCurrentConfig).toBe(false);
    const qualified = evaluateSourcePublicationEligibility(currentSource(), [attempt(1), attempt(2)]);
    expect(qualified).toMatchObject({
      hasQualifiedCurrentConfig: true,
      latestWindowHealthy: true,
      qualifiedAt: attempt(2).finishedAt,
      reasonCode: "ALL_CURRENT_STAGED_SOURCES_QUALIFIED"
    });
    expect(evaluateSourcePublicationEligibility(
      currentSource(),
      [attempt(1), failedAttempt(2), attempt(3)]
    ).hasQualifiedCurrentConfig).toBe(false);
  });

  it("keeps qualification sticky while health needs two recovery successes", () => {
    const sequence = [attempt(1), attempt(2), failedAttempt(3)];
    expect(evaluateSourcePublicationEligibility(currentSource(), sequence)).toMatchObject({
      hasQualifiedCurrentConfig: true,
      latestWindowHealthy: false,
      reasonCode: "QUALIFIED_BUT_LATEST_WINDOW_UNHEALTHY"
    });
    expect(evaluateSourcePublicationEligibility(currentSource(), [...sequence, attempt(4)]).latestWindowHealthy).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [...sequence, attempt(4), attempt(5)]).latestWindowHealthy).toBe(true);
  });

  it("keeps a zero-observation terminal failure in the adjacent sequence", () => {
    const evaluation = evaluateSourcePublicationEligibility(
      currentSource(),
      [attempt(1), failedAttempt(2, { observations: [] }), attempt(3)]
    );
    expect(evaluation.hasQualifiedCurrentConfig).toBe(false);
    expect(evaluation.reasonCode).toBe("AWAITING_TWO_ADJACENT_SUCCESSES");
  });

  it("resets qualification naturally for a new config and does not splice around mismatches", () => {
    const h1 = [attempt(1, { sourceConfigHash: OTHER_CONFIG }), attempt(2, { sourceConfigHash: OTHER_CONFIG })];
    expect(evaluateSourcePublicationEligibility(currentSource(), h1).hasQualifiedCurrentConfig).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [...h1, attempt(3)]).hasQualifiedCurrentConfig).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [...h1, attempt(3), attempt(4)]).hasQualifiedCurrentConfig).toBe(true);
    expect(evaluateSourcePublicationEligibility(currentSource(), [
      attempt(1),
      attempt(2, { sourceConfigHash: OTHER_CONFIG }),
      attempt(3)
    ]).hasQualifiedCurrentConfig).toBe(false);
  });

  it("ignores a RUNNING pending row", () => {
    const inFlight = attempt(3, {
      batchStatus: "RUNNING",
      batchFinishedAt: null,
      finishedAt: null,
      transportState: "PENDING",
      adapterState: "PENDING",
      completenessState: "PENDING",
      atomicCommitState: "PENDING",
      observation: null
    });
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), attempt(2), inFlight]).latestWindowHealthy).toBe(true);
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), attempt(2), {
      ...inFlight,
      batchStatus: "FAILED"
    }]).latestWindowHealthy).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), attempt(2), {
      ...inFlight,
      observations: attempt(3).observations
    }]).latestWindowHealthy).toBe(true);
  });

  it("ignores every RUNNING batch even when a source result has already become terminal", () => {
    const runningSuccess = attempt(1, { batchStatus: "RUNNING", batchFinishedAt: null });
    const runningFailure = failedAttempt(3, { batchStatus: "RUNNING", batchFinishedAt: null });
    expect(evaluateSourcePublicationEligibility(currentSource(), [runningSuccess, attempt(3)]))
      .toMatchObject({ hasQualifiedCurrentConfig: false, latestWindowHealthy: false });
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), attempt(2), runningFailure]))
      .toMatchObject({ hasQualifiedCurrentConfig: true, latestWindowHealthy: true });
  });

  it("keeps a terminal batch with missing finish or pending source result as a breaking failure", () => {
    const missingBatchFinish = attempt(2, { batchStatus: "SUCCESS", batchFinishedAt: null });
    const pendingSource = attempt(2, {
      batchStatus: "FAILED",
      finishedAt: null,
      transportState: "PENDING",
      adapterState: "PENDING",
      completenessState: "PENDING",
      atomicCommitState: "PENDING",
      observation: null
    });
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), missingBatchFinish, attempt(3)]).hasQualifiedCurrentConfig).toBe(false);
    expect(evaluateSourcePublicationEligibility(currentSource(), [attempt(1), pendingSource, attempt(3)]).hasQualifiedCurrentConfig).toBe(false);
  });

  it("orders completed events by batch start rather than completion time", () => {
    const earlySuccessFinishingLast = attempt(1, {
      batchStartedAt: new Date("2026-07-14T01:00:00.000Z"),
      finishedAt: new Date("2026-07-14T01:30:00.000Z")
    });
    const middleFailure = failedAttempt(2, {
      batchStartedAt: new Date("2026-07-14T01:01:00.000Z"),
      finishedAt: new Date("2026-07-14T01:02:00.000Z")
    });
    const lateSuccessFinishingEarly = attempt(3, {
      batchStartedAt: new Date("2026-07-14T01:03:00.000Z"),
      finishedAt: new Date("2026-07-14T01:04:00.000Z")
    });
    expect(evaluateSourcePublicationEligibility(currentSource(), [
      lateSuccessFinishingEarly,
      earlySuccessFinishingLast,
      middleFailure
    ]).hasQualifiedCurrentConfig).toBe(false);
  });

  it("is permutation-stable and rejects duplicate or unsupported events", () => {
    const chronological = [attempt(1), failedAttempt(2), attempt(3), attempt(4)];
    expect(evaluateSourcePublicationEligibility(currentSource(), [...chronological].reverse()))
      .toEqual(evaluateSourcePublicationEligibility(currentSource(), chronological));
    expect(() => evaluateSourcePublicationEligibility(currentSource(), [attempt(1), {
      ...attempt(2),
      batchId: attempt(1).batchId
    }])).toThrow(/DUPLICATE_SOURCE_ATTEMPT/);
    expect(() => evaluateSourcePublicationEligibility(currentSource(), [
      { ...attempt(1), batchKind: "MANUAL_SOURCE" } as unknown as PublicationAttempt
    ])).toThrow(/UNSUPPORTED_PUBLICATION_BATCH_KIND/);
    expect(() => evaluateSourcePublicationEligibility(currentSource(), [
      { ...attempt(1), batchStatus: "PENDING" } as unknown as PublicationAttempt
    ])).toThrow(/UNSUPPORTED_PUBLICATION_BATCH_STATUS/);
  });
});

describe("company publication state", () => {
  it("keeps a company verifying until every canonical official social source is staged", () => {
    const multiOfficialCompany = company({
      sources: ["source-a", "source-b"].map((sourceId) => ({
        id: sourceId,
        companyId: "company-test",
        kind: "SOCIAL" as const,
        atsKind: "OFFICIAL_JSON" as const,
        status: "VERIFIED_SCRAPABLE" as const,
        officialEntryUrl: `https://jobs.example.test/${sourceId}`,
        officialChainEvidenceUrl: "https://example.test/careers"
      }))
    });
    const sourceA = currentSource("source-a");
    const sourceB = currentSource("source-b");
    const sourceAAttempts = [attempt(1, { sourceId: "source-a" }), attempt(2, { sourceId: "source-a" })];
    expect(buildCompanyPublicationSnapshot(
      [multiOfficialCompany],
      [sourceA],
      sourceAAttempts
    ).companies[0]).toMatchObject({
      state: "VERIFYING",
      health: "NOT_APPLICABLE",
      eligibleSourceIds: [],
      reasonCode: "OFFICIAL_ENTRY_NOT_AUTOMATED"
    });

    expect(buildCompanyPublicationSnapshot(
      [multiOfficialCompany],
      [sourceA, sourceB],
      [
        ...sourceAAttempts,
        attempt(3, { sourceId: "source-b" }),
        attempt(4, { sourceId: "source-b" })
      ]
    ).companies[0]).toMatchObject({
      state: "PUBLISHING",
      health: "HEALTHY",
      eligibleSourceIds: ["source-a", "source-b"]
    });
  });

  it("uses an all-sources rule and retains all eligible ids when health degrades", () => {
    const sources = [currentSource("source-a"), currentSource("source-b")];
    const onlyA = [attempt(1, { sourceId: "source-a" }), attempt(2, { sourceId: "source-a" })];
    expect(buildCompanyPublicationSnapshot([company()], sources, onlyA).companies[0]).toMatchObject({
      state: "VERIFYING",
      health: "NOT_APPLICABLE",
      eligibleSourceIds: []
    });

    const both = [
      ...onlyA,
      attempt(3, { sourceId: "source-b" }),
      attempt(4, { sourceId: "source-b" })
    ];
    expect(buildCompanyPublicationSnapshot([company()], sources, both).companies[0]).toMatchObject({
      state: "PUBLISHING",
      health: "HEALTHY",
      stagedSourceIds: ["source-a", "source-b"],
      eligibleSourceIds: ["source-a", "source-b"]
    });
    const degraded = buildCompanyPublicationSnapshot(
      [company()],
      sources,
      [...both, failedAttempt(5, { sourceId: "source-a" })]
    ).companies[0]!;
    expect(degraded).toMatchObject({
      state: "PUBLISHING",
      health: "DEGRADED",
      eligibleSourceIds: ["source-a", "source-b"]
    });
  });

  it("applies exclusion, no-link, official-link-only, then verifying priority", () => {
    const exclusion = candidateCompanies.find(({ id }) => id === "company-humanwell")!;
    const noLink = company({ id: "company-no-link", targetStatus: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" });
    const linkOnly = company({
      id: "company-link-only",
      sources: [{
        id: "source-link-only",
        companyId: "company-link-only",
        kind: "SOCIAL",
        atsKind: "UNKNOWN",
        status: "ENTRY_FOUND_PENDING_ADAPTER",
        officialEntryUrl: "https://jobs.example.test",
        officialChainEvidenceUrl: "https://example.test/careers"
      }]
    });
    const verifying = company({ id: "company-verifying", sources: [] });
    const records = buildCompanyPublicationSnapshot(
      [verifying, linkOnly, noLink, exclusion],
      [],
      []
    ).companies;
    expect(Object.fromEntries(records.map((record) => [record.companyId, record.state]))).toEqual({
      "company-verifying": "VERIFYING",
      "company-link-only": "OFFICIAL_LINK_ONLY",
      "company-no-link": "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME",
      "company-humanwell": "USER_AUTHORIZED_PHASE1_EXCLUSION"
    });
    expect(records.every(({ health }) => health === "NOT_APPLICABLE")).toBe(true);
  });

  it("sorts companies and all derived ids deterministically", () => {
    const companies = [
      company({ id: "company-z", pinyinName: "same" }),
      company({ id: "company-a", pinyinName: "same" })
    ];
    const snapshot = buildCompanyPublicationSnapshot(companies, [], []);
    expect(snapshot.companies.map(({ companyId }) => companyId)).toEqual(["company-a", "company-z"]);
    expect(Object.values(snapshot.countsByState).reduce((sum, count) => sum + count, 0)).toBe(companies.length);
    expect(Object.values(snapshot.countsByHealth).reduce((sum, count) => sum + count, 0)).toBe(companies.length);
  });
});
