import { describe, expect, it } from "vitest";
import {
  evaluateStagedDataQuality,
  type StagedDataQualityInput
} from "../../src/readiness/stagedDataQuality";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";

const tuple = {
  releaseCandidateId: "rc-current",
  batchId: "batch-current",
  sourceResultId: "result-current",
  sourceId: "source-a"
};
const sourceConfigSha256 = "a".repeat(64);

function input(): StagedDataQualityInput {
  const key = "source-a:job-1";
  const currentSha256 = canonicalStringSetSha256([key]);
  const emptySha256 = canonicalStringSetSha256([]);
  return {
    releaseCandidateId: tuple.releaseCandidateId,
    eligibleSources: [{
      sourceId: tuple.sourceId,
      companyId: "company-a",
      currentConfigSha256: sourceConfigSha256
    }],
    latestSourceResults: [{
      ...tuple,
      sourceConfigHash: sourceConfigSha256,
      batchKind: "SCHEDULED",
      transportState: "SUCCEEDED",
      adapterState: "SUCCEEDED",
      completenessState: "VERIFIED",
      atomicCommitState: "COMMITTED",
      dedupeOutputCount: 1,
      expectedJobCount: 1,
      canonicalOutputSetSha256: currentSha256,
      canonicalCurrentJobSetSha256: currentSha256,
      canonicalGraceJobSetSha256: emptySha256,
      canonicalVisibleJobSetSha256: currentSha256,
      observation: {
        ...tuple,
        sourceConfigSha256,
        successful: true,
        transportSucceeded: true,
        adapterSucceeded: true,
        completenessVerified: true,
        atomicCommitSucceeded: true,
        structuredJobCount: 1,
        expectedJobCount: 1,
        completenessStatus: "VERIFIED",
        canonicalOutputSha256: currentSha256,
        canonicalGraceSha256: emptySha256,
        canonicalVisibleSha256: currentSha256
      },
      lifecycleSetEvidence: {
        ...tuple,
        currentKeys: [key],
        currentSha256,
        graceEntries: [],
        graceSha256: emptySha256,
        visibleKeys: [key],
        visibleSha256: currentSha256,
        lifecycleEntries: [{
          ...tuple,
          key,
          status: "ACTIVE",
          missingSuccessfulCrawlCount: 0
        }]
      }
    }],
    publicVisibleJobs: [{
      sourceId: tuple.sourceId,
      dedupeKey: key,
      companyId: "company-a",
      officialTitle: "Medical Manager",
      officialUrl: "https://careers.example.com/job/1",
      locationRaw: "Shanghai"
    }]
  };
}

describe("staged public data quality", () => {
  it("passes an exact eligible-source lifecycle and public-job projection", () => {
    expect(evaluateStagedDataQuality(input())).toMatchObject({
      canRelease: true,
      eligibleSourceCount: 1,
      publicVisibleJobCount: 1,
      issues: []
    });
  });

  it("fails when the database public job set differs from the committed visible set", () => {
    const value = input();
    value.publicVisibleJobs[0]!.dedupeKey = "source-a:forged-job";
    const report = evaluateStagedDataQuality(value);
    expect(report.canRelease).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "PUBLIC_JOB_SET_MISMATCH",
      sourceId: "source-a"
    }));
  });

  it("fails closed for non-scheduled, non-atomic, or incomplete latest source truth", () => {
    for (const patch of [
      { batchKind: "FULL_RELEASE" },
      { atomicCommitState: "ROLLED_BACK" },
      { completenessState: "INCOMPLETE" }
    ]) {
      const value = input();
      Object.assign(value.latestSourceResults[0]!, patch);
      expect(evaluateStagedDataQuality(value).issues).toContainEqual(expect.objectContaining({
        code: "LATEST_SOURCE_RESULT_NOT_RELEASE_ELIGIBLE",
        sourceId: "source-a"
      }));
    }
  });

  it("rejects duplicate or missing eligible source projections", () => {
    const duplicate = input();
    duplicate.eligibleSources.push({ ...duplicate.eligibleSources[0]! });
    expect(evaluateStagedDataQuality(duplicate).issues.map(({ code }) => code))
      .toContain("ELIGIBLE_SOURCE_SET_INVALID");

    const missing = input();
    missing.latestSourceResults = [];
    expect(evaluateStagedDataQuality(missing).issues).toContainEqual(expect.objectContaining({
      code: "LATEST_SOURCE_RESULT_MISSING",
      sourceId: "source-a"
    }));
  });

  it("rejects a job bound to the wrong company or a mismatched current config", () => {
    const wrongCompany = input();
    wrongCompany.publicVisibleJobs[0]!.companyId = "company-b";
    expect(evaluateStagedDataQuality(wrongCompany).issues).toContainEqual(expect.objectContaining({
      code: "PUBLIC_JOB_FIELDS_INVALID",
      sourceId: "source-a"
    }));

    const wrongConfig = input();
    wrongConfig.latestSourceResults[0]!.sourceConfigHash = "b".repeat(64);
    expect(evaluateStagedDataQuality(wrongConfig).issues).toContainEqual(expect.objectContaining({
      code: "LATEST_SOURCE_RESULT_NOT_RELEASE_ELIGIBLE",
      sourceId: "source-a"
    }));
  });
});
