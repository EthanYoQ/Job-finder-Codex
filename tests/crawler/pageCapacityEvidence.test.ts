import { describe, expect, it } from "vitest";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";
import { parsePersistentSourceFetchEvidence, sha256Bytes,
  type PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";

function input(options: {
  raw?: string[]; valid?: string[]; requested?: number | null; returned?: number | null;
  next?: string | null; total?: number | null; termination?: "NEXT_ABSENT" | "ABORTED";
}): PersistentSourceFetchEvidence {
  const raw = options.raw ?? ["a", "b"];
  const body = JSON.stringify({ ids: raw, total: options.total });
  return {
    captureTool: { name: "capacity-matrix", version: "1" },
    artifacts: [{ id: "a1", logicalKey: "p1", kind: "ATS_API_RESPONSE", requestedUrl: "https://example.test/p1",
      finalUrl: "https://example.test/p1", httpStatus: 200, contentType: "application/json",
      capturedAt: "2026-07-11T00:00:00.000Z", body, extractorLocator: "$.ids" }],
    pages: [{ sequence: 0, artifactLogicalKey: "p1", requestedPage: 1, returnedPage: 1,
      requestedPageSize: options.requested ?? null, returnedPageSize: options.returned ?? null,
      rawJobIds: raw, validJobIds: options.valid ?? raw, declaredTotal: options.total ?? null,
      nextPageSignalBefore: "1", nextPageSignalAfter: options.next ?? null,
      responseFingerprintSha256: sha256Bytes(Buffer.from(body)).sha256,
      termination: options.termination ?? "ABORTED", anomalyCodes: [], capturedAt: "2026-07-11T00:00:00.000Z" }],
    fetchCounts: { rawCount: raw.length, parsedCount: raw.length, validCount: (options.valid ?? raw).length,
      parseDiscardCount: 0, validationDiscardCount: raw.length - (options.valid ?? raw).length },
    fetchLosses: (options.valid ?? raw).length === raw.length ? [] : [{ stage: "VALIDATION", reason: "invalid row", rawLocator: "p1",
      details: { code: "INVALID_ROW", pageSequence: 0 } }]
  };
}

function canonical(value: unknown) {
  return deriveCanonicalPaginationEvidence({ evidence: value, expectedChannelIds: [], filteredOutput: true });
}

describe("page capacity evidence matrix", () => {
  it("marks a nonempty raw short page unsafe when an official next signal remains", () => {
    const derived = canonical(input({ requested: 10, returned: 10, next: "2" }));
    expect(derived.pages[0]!.anomalyCodes).toContain("INTERMEDIATE_SHORT_PAGE");
    expect(evaluatePaginationEvidence({ evidence: derived, expectedChannelIds: [], filteredOutput: true }).safeCompleteness).toBe(false);
  });

  it("allows a truthful terminal short page and does not guess when capacity is absent", () => {
    const terminal = canonical(input({ requested: 10, returned: 10, next: null, termination: "NEXT_ABSENT" }));
    expect(terminal.pages[0]!.anomalyCodes).not.toContain("INTERMEDIATE_SHORT_PAGE");
    const absent = canonical(input({ requested: null, returned: null, next: "2" }));
    expect(absent.pages[0]!.anomalyCodes).not.toContain("INTERMEDIATE_SHORT_PAGE");
  });

  it("uses raw count rather than valid count after a recorded loss", () => {
    const fullRaw = Array.from({ length: 10 }, (_, index) => `id-${index}`);
    const derived = canonical(input({ raw: fullRaw, valid: fullRaw.slice(0, 9), requested: 10, returned: 10, next: "2" }));
    expect(derived.pages[0]!.anomalyCodes).not.toContain("INTERMEDIATE_SHORT_PAGE");
  });

  it("flags a request/official returned capacity contradiction", () => {
    const derived = canonical(input({ requested: 10, returned: 20, next: "2" }));
    expect(derived.pages[0]!.anomalyCodes).toContain("RETURNED_PAGE_SIZE_MISMATCH");
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid present page capacity %s", (value) => {
    expect(() => parsePersistentSourceFetchEvidence(input({ requested: value, returned: null, next: "2" }))).toThrow();
  });

  it("does not treat a page-level loss without recordIndex as a raw row", () => {
    const value = input({ requested: 2, returned: 2, next: "2" });
    value.fetchCounts = { rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 };
    value.fetchLosses = [{ stage: "VALIDATION", reason: "page diagnostic", rawLocator: "p1",
      details: { code: "PAGE_DIAGNOSTIC", pageSequence: 0 } }];
    value.pages[0]!.rawJobIds = ["a"];
    value.pages[0]!.validJobIds = ["a"];
    expect(canonical(value).pages[0]!.anomalyCodes).toContain("INTERMEDIATE_SHORT_PAGE");
  });

  it("counts multiple losses for one recordIndex only once", () => {
    const value = input({ requested: 3, returned: 3, next: "2" });
    value.fetchCounts = { rawCount: 3, parsedCount: 3, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 2 };
    value.fetchLosses = [
      { stage: "VALIDATION", reason: "first field", rawLocator: "p1", details: { code: "FIELD_ONE", pageSequence: 0, recordIndex: 7 } },
      { stage: "VALIDATION", reason: "second field", rawLocator: "p1", details: { code: "FIELD_TWO", pageSequence: 0, recordIndex: 7 } }
    ];
    value.pages[0]!.rawJobIds = ["a"];
    value.pages[0]!.validJobIds = ["a"];
    expect(canonical(value).pages[0]!.anomalyCodes).toContain("INTERMEDIATE_SHORT_PAGE");
  });

  it("lets one strict row loss complete raw capacity without a false short-page anomaly", () => {
    const value = input({ requested: 2, returned: 2, next: "2" });
    value.fetchCounts = { rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 };
    value.fetchLosses = [{ stage: "VALIDATION", reason: "row rejected", rawLocator: "p1",
      details: { code: "ROW_REJECTED", pageSequence: 0, recordIndex: 3 } }];
    value.pages[0]!.rawJobIds = ["a"];
    value.pages[0]!.validJobIds = ["a"];
    expect(canonical(value).pages[0]!.anomalyCodes).not.toContain("INTERMEDIATE_SHORT_PAGE");
  });

  it("does not borrow row losses from another page or channel scope", () => {
    const value = input({ requested: 2, returned: 2, next: "social-next" });
    value.artifacts[0]!.channelId = "social";
    value.pages[0]!.channelId = "social";
    value.pages[0]!.rawJobIds = ["social-a"];
    value.pages[0]!.validJobIds = ["social-a"];
    const body = '{"ids":["medical-a"]}';
    value.artifacts.push({ ...value.artifacts[0]!, id: "a2", logicalKey: "p2", channelId: "medical", body });
    value.pages.push({ ...value.pages[0]!, sequence: 1, artifactLogicalKey: "p2", channelId: "medical",
      rawJobIds: ["medical-a"], validJobIds: [], requestedPageSize: 1, returnedPageSize: 1,
      nextPageSignalBefore: null, nextPageSignalAfter: null, termination: "NEXT_ABSENT",
      responseFingerprintSha256: sha256Bytes(Buffer.from(body)).sha256 });
    value.fetchCounts = { rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 };
    value.fetchLosses = [{ stage: "VALIDATION", reason: "medical row", rawLocator: "p2",
      details: { code: "ROW_REJECTED", pageSequence: 1, recordIndex: 0 } }];
    const derived = deriveCanonicalPaginationEvidence({ evidence: value,
      expectedChannelIds: ["social", "medical"], filteredOutput: true });
    expect(derived.pages[0]!.anomalyCodes).toContain("INTERMEDIATE_SHORT_PAGE");
    expect(derived.pages[1]!.anomalyCodes).not.toContain("INTERMEDIATE_SHORT_PAGE");
  });
});
