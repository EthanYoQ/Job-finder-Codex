import { describe, expect, it } from "vitest";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { sha256Bytes, type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";

const families = [
  "Workday", "Moka", "Hotjob Legacy", "Hotjob Wecruit", "Official HTML",
  "Phenom", "Beisen", "CNStaff", "HCM", "Jobsyn", "Sandoz", "Redsea", "Xiuzheng"
] as const;

function contradictoryCapacityEvidence(family: string): PersistentSourceFetchEvidence {
  const body = JSON.stringify({ family, total: 1, jobs: [{ id: "a" }, { id: "b" }] });
  return {
    captureTool: { name: "cross-variant-fixture", version: "1" },
    artifacts: [{
      id: `artifact-${family.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      logicalKey: "page-1", kind: "PAGINATION_PAGE",
      requestedUrl: "https://jobs.example.test/api?page=1",
      finalUrl: "https://jobs.example.test/api?page=1", httpStatus: 200,
      contentType: "application/json", capturedAt: "2026-07-11T00:00:00.000Z",
      body, extractorLocator: "$.total"
    }],
    pages: [{
      sequence: 0, artifactLogicalKey: "page-1", requestedPage: 1, returnedPage: 1,
      rawJobIds: ["a", "b"], validJobIds: ["a", "b"], declaredTotal: 1,
      nextPageSignalBefore: "page-1", nextPageSignalAfter: null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(body, "utf8")).sha256,
      termination: "NEXT_ABSENT", anomalyCodes: [],
      capturedAt: "2026-07-11T00:00:00.000Z"
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT", value: 1, artifactLogicalKey: "page-1",
      extractorLocator: "$.total", scope: "SOURCE"
    },
    fetchCounts: {
      rawCount: 2, parsedCount: 2, validCount: 2,
      parseDiscardCount: 0, validationDiscardCount: 0
    },
    fetchLosses: []
  };
}

function overlappingEvidence(options: {
  secondChannel?: string;
  secondIds?: string[];
  declaredTotal?: number;
  finalTermination?: "NEXT_ABSENT" | "FAILED";
} = {}): PersistentSourceFetchEvidence {
  const firstBody = '{"jobs":[{"id":"a"}],"total":2}';
  const secondIds = options.secondIds ?? ["a", "b"];
  const secondBody = JSON.stringify({ jobs: secondIds.map((id) => ({ id })), total: options.declaredTotal ?? 2 });
  const secondChannel = options.secondChannel;
  return {
    captureTool: { name: "cross-variant-fixture", version: "1" },
    artifacts: [
      {
        id: "artifact-overlap-1", logicalKey: "overlap-page-1", kind: "PAGINATION_PAGE",
        channelId: "social", requestedUrl: "https://jobs.example.test/api?page=1",
        finalUrl: "https://jobs.example.test/api?page=1", httpStatus: 200,
        contentType: "application/json", capturedAt: "2026-07-11T00:00:00.000Z",
        body: firstBody, extractorLocator: "$.total"
      },
      {
        id: "artifact-overlap-2", logicalKey: "overlap-page-2", kind: "PAGINATION_PAGE",
        channelId: secondChannel ?? "social", requestedUrl: "https://jobs.example.test/api?page=2",
        finalUrl: "https://jobs.example.test/api?page=2", httpStatus: 200,
        contentType: "application/json", capturedAt: "2026-07-11T00:01:00.000Z",
        body: secondBody, extractorLocator: "$.total"
      }
    ],
    pages: [
      {
        sequence: 0, artifactLogicalKey: "overlap-page-1", channelId: "social",
        requestedPage: 1, returnedPage: 1, rawJobIds: ["a"], validJobIds: ["a"],
        declaredTotal: options.declaredTotal ?? 2, nextPageSignalBefore: "page-1",
        nextPageSignalAfter: secondChannel ? null : "page-2",
        responseFingerprintSha256: sha256Bytes(Buffer.from(firstBody, "utf8")).sha256,
        termination: secondChannel ? "NEXT_ABSENT" : "CONTINUE", anomalyCodes: [],
        capturedAt: "2026-07-11T00:00:00.000Z"
      },
      {
        sequence: 1, artifactLogicalKey: "overlap-page-2", channelId: secondChannel ?? "social",
        requestedPage: secondChannel ? 1 : 2, returnedPage: secondChannel ? 1 : 2,
        rawJobIds: secondIds, validJobIds: secondIds, declaredTotal: options.declaredTotal ?? 2,
        nextPageSignalBefore: secondChannel ? "medical-page-1" : "page-2", nextPageSignalAfter: null,
        responseFingerprintSha256: sha256Bytes(Buffer.from(secondBody, "utf8")).sha256,
        termination: options.finalTermination ?? "NEXT_ABSENT", anomalyCodes: [],
        capturedAt: "2026-07-11T00:01:00.000Z"
      }
    ],
    fetchCounts: {
      rawCount: 1 + secondIds.length, parsedCount: 1 + secondIds.length,
      validCount: 1 + secondIds.length, parseDiscardCount: 0, validationDiscardCount: 0
    },
    fetchLosses: []
  };
}

describe("Task 5D5K cross-variant pagination truthfulness", () => {
  it.each(families)("%s rejects declared capacity below observed raw unique rows", (family) => {
    const evidence = contradictoryCapacityEvidence(family);
    const derived = deriveCanonicalPaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true });
    expect(derived.pages[0]!.anomalyCodes).toContain("DECLARED_CAPACITY_CONTRADICTION");
    expect(evaluatePaginationEvidence({ evidence: derived, expectedChannelIds: [], filteredOutput: true }))
      .toMatchObject({
        derivedAnomalyCodes: ["DECLARED_CAPACITY_CONTRADICTION"],
        safeCompleteness: false,
        verifiedEligible: false
      });
  });

  it("rejects a raw ID observed on two pages in the same scope", () => {
    const derived = deriveCanonicalPaginationEvidence({
      evidence: overlappingEvidence(), expectedChannelIds: ["social"], filteredOutput: true
    });
    expect(derived.pages[1]!.anomalyCodes).toEqual(["RAW_ID_OVERLAP_ACROSS_PAGES"]);
    expect(evaluatePaginationEvidence({ evidence: derived, expectedChannelIds: ["social"], filteredOutput: true }))
      .toMatchObject({ safeCompleteness: false, verifiedEligible: false });
  });

  it("does not compare identical raw IDs across distinct channel scopes", () => {
    const derived = deriveCanonicalPaginationEvidence({
      evidence: overlappingEvidence({ secondChannel: "medical", secondIds: ["a"], declaredTotal: 1 }),
      expectedChannelIds: ["social", "medical"], filteredOutput: true
    });
    expect(derived.pages.flatMap((page) => page.anomalyCodes)).not.toContain("RAW_ID_OVERLAP_ACROSS_PAGES");
  });

  it("retains the overlap anomaly when the later page fails", () => {
    const derived = deriveCanonicalPaginationEvidence({
      evidence: overlappingEvidence({ finalTermination: "FAILED" }),
      expectedChannelIds: ["social"], filteredOutput: true
    });
    expect(derived.pages[1]!.anomalyCodes).toContain("RAW_ID_OVERLAP_ACROSS_PAGES");
    expect(evaluatePaginationEvidence({ evidence: derived, expectedChannelIds: ["social"], filteredOutput: true }).safeCompleteness)
      .toBe(false);
  });

  it("reports overlap and capacity contradiction independently", () => {
    const derived = deriveCanonicalPaginationEvidence({
      evidence: overlappingEvidence({ secondIds: ["a", "b", "c"], declaredTotal: 2 }),
      expectedChannelIds: ["social"], filteredOutput: true
    });
    expect(derived.pages[1]!.anomalyCodes).toEqual([
      "DECLARED_CAPACITY_CONTRADICTION", "RAW_ID_OVERLAP_ACROSS_PAGES"
    ]);
  });
});
