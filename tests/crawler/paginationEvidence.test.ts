import { describe, expect, it } from "vitest";
import {
  sha256Bytes,
  type PersistentSourceFetchEvidence,
  type SourceFetchPageTrace
} from "../../src/crawler/sourceFetchEvidence";
import { deriveCanonicalPaginationEvidence, evaluatePaginationEvidence } from "../../src/crawler/paginationEvidence";

const H = (body: string) => sha256Bytes(Buffer.from(body, "utf8")).sha256;

function evidence(body = '{"total":2,"ids":["a","b"]}'): PersistentSourceFetchEvidence {
  return {
    captureTool: { name: "undici", version: "7.1.0" },
    artifacts: [{
      id: "artifact-1", logicalKey: "page-1", kind: "ATS_API_RESPONSE",
      channelId: "social", requestedUrl: "https://jobs.example.test/api?page=1",
      finalUrl: "https://jobs.example.test/api?page=1", httpStatus: 200,
      contentType: "application/json", capturedAt: "2026-07-10T10:00:00.000Z",
      body, extractorLocator: "$.total"
    }],
    pages: [{
      sequence: 0, artifactLogicalKey: "page-1", channelId: "social",
      requestedPage: 1, returnedPage: 1, rawJobIds: ["b", "a"], validJobIds: ["a", "b"],
      declaredTotal: 2, nextPageSignalBefore: "page-1", nextPageSignalAfter: null,
      responseFingerprintSha256: H(body), termination: "DECLARED_TOTAL_REACHED",
      anomalyCodes: [], capturedAt: "2026-07-10T10:00:00.000Z"
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT", value: 2, artifactLogicalKey: "page-1",
      extractorLocator: "$.total", scope: "CHANNEL", channelId: "social"
    },
    fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  };
}

function evaluate(input = evidence(), expectedChannelIds = ["social"], filteredOutput = true) {
  return evaluatePaginationEvidence({ evidence: input, expectedChannelIds, filteredOutput });
}

function addPage(input: PersistentSourceFetchEvidence, options: {
  body: string; rawJobIds?: string[]; validJobIds?: string[];
  anomalyCodes?: SourceFetchPageTrace["anomalyCodes"];
}) {
  input.pages[0]!.nextPageSignalAfter = "page-2";
  input.pages[0]!.termination = "CONTINUE";
  input.artifacts.push({
    ...input.artifacts[0]!, id: "artifact-2", logicalKey: "page-2", body: options.body,
    requestedUrl: "https://jobs.example.test/api?page=2",
    finalUrl: "https://jobs.example.test/api?page=2", capturedAt: "2026-07-10T10:01:00.000Z"
  });
  input.pages.push({
    ...input.pages[0]!, sequence: 1, artifactLogicalKey: "page-2", requestedPage: 2,
    returnedPage: 2, rawJobIds: options.rawJobIds ?? ["c"], validJobIds: options.validJobIds ?? ["c"],
    responseFingerprintSha256: H(options.body), nextPageSignalBefore: "page-2", nextPageSignalAfter: null,
    termination: "NEXT_ABSENT",
    anomalyCodes: options.anomalyCodes ?? [], capturedAt: "2026-07-10T10:01:00.000Z"
  });
  const observedTotal = new Set(input.pages.flatMap((page) => page.rawJobIds)).size;
  for (const page of input.pages) page.declaredTotal = observedTotal;
  if (input.declaredCompleteness?.kind === "OFFICIAL_TOTAL_COUNT") {
    input.declaredCompleteness.value = observedTotal;
  }
}

describe("shared pagination evidence evaluator", () => {
  it("rejects supporting-artifact-only failure evidence from both D1 entry points", () => {
    const supporting = {
      ...evidence(), pages: [], declaredCompleteness: undefined,
      supportingArtifactOnlyFailure: { code: "ROOT_RESPONSE_FAILED" },
      fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 }
    } as unknown as PersistentSourceFetchEvidence;
    expect(() => deriveCanonicalPaginationEvidence({ evidence: supporting, expectedChannelIds: [], filteredOutput: true }))
      .toThrow(/supporting-artifact-only failure/u);
    expect(() => evaluatePaginationEvidence({ evidence: supporting, expectedChannelIds: [], filteredOutput: true }))
      .toThrow(/supporting-artifact-only failure/u);
  });
  it("derives canonical caller labels before the unchanged strict evaluator gate", () => {
    const input = evidence();
    input.pages[0]!.returnedPage = 0;
    input.pages[0]!.nextPageSignalAfter = "page-2";
    input.pages[0]!.termination = "ABORTED";
    expect(input.pages[0]!.anomalyCodes).toEqual([]);

    const canonical = deriveCanonicalPaginationEvidence({
      evidence: input,
      expectedChannelIds: ["social"],
      filteredOutput: true
    });

    expect(canonical.pages[0]!.anomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
    expect(evaluatePaginationEvidence({
      evidence: canonical,
      expectedChannelIds: ["social"],
      filteredOutput: true
    }).derivedAnomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
  });

  it("derives the response fingerprint from exact artifact bytes and rejects a caller mismatch", () => {
    const input = evidence();
    expect(evaluate(input).pages[0]!.responseFingerprintSha256).toBe(H(input.artifacts[0]!.body as string));
    input.pages[0]!.responseFingerprintSha256 = "0".repeat(64);
    expect(() => evaluate(input)).toThrow(/response fingerprint.*artifact body/i);
  });

  it("independently detects repeated response bytes and repeated ID sets while next remains", () => {
    const repeatedBody = evidence();
    addPage(repeatedBody, { body: repeatedBody.artifacts[0]!.body as string, rawJobIds: ["c"], validJobIds: ["c"],
      anomalyCodes: ["REPEATED_RESPONSE_FINGERPRINT"] });
    repeatedBody.pages[1]!.nextPageSignalAfter = "page-3";
    repeatedBody.pages[1]!.termination = "ABORTED";
    expect(evaluate(repeatedBody).derivedAnomalyCodes).toEqual(["REPEATED_RESPONSE_FINGERPRINT"]);

    const repeatedIds = evidence();
    addPage(repeatedIds, { body: '{"different":true}', rawJobIds: ["a", "b"], validJobIds: ["b", "a"],
      anomalyCodes: ["RAW_ID_OVERLAP_ACROSS_PAGES", "REPEATED_JOB_ID_SET_WITH_NEXT"] });
    repeatedIds.pages[1]!.nextPageSignalAfter = "page-3";
    repeatedIds.pages[1]!.termination = "ABORTED";
    expect(evaluate(repeatedIds).derivedAnomalyCodes).toEqual([
      "RAW_ID_OVERLAP_ACROSS_PAGES", "REPEATED_JOB_ID_SET_WITH_NEXT"
    ]);
  });

  it("detects a same-page requested/returned-page mismatch", () => {
    const input = evidence();
    input.pages[0]!.requestedCursor = "cursor-1";
    input.pages[0]!.returnedCursor = "cursor-1";
    input.pages[0]!.requestedOffset = 0;
    input.pages[0]!.returnedOffset = 0;
    input.pages[0]!.returnedPage = 0;
    input.pages[0]!.nextPageSignalAfter = "page-2";
    input.pages[0]!.termination = "ABORTED";
    input.pages[0]!.anomalyCodes = ["RETURNED_PAGE_MISMATCH"];
    expect(evaluate(input).derivedAnomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
  });

  it("derives an offset anomaly when one response contradicts its requested offset", () => {
    const input = evidence();
    input.pages[0]!.requestedPage = null;
    input.pages[0]!.returnedPage = null;
    input.pages[0]!.requestedOffset = 0;
    input.pages[0]!.returnedOffset = 50;
    input.pages[0]!.nextPageSignalAfter = "offset-50";
    input.pages[0]!.termination = "ABORTED";

    const canonical = deriveCanonicalPaginationEvidence({
      evidence: input,
      expectedChannelIds: ["social"],
      filteredOutput: true
    });

    expect(canonical.pages[0]!.anomalyCodes).toEqual(["OFFSET_NOT_ADVANCING"]);
    expect(evaluate(canonical).derivedAnomalyCodes).toEqual(["OFFSET_NOT_ADVANCING"]);
  });

  it("detects declared total/count/pages changes only in comparable channel scope", () => {
    const input = evidence();
    input.pages[0]!.declaredCount = 2;
    input.pages[0]!.declaredPages = 2;
    addPage(input, { body: '{"total":3}', anomalyCodes: ["TOTAL_CHANGED"] });
    input.pages[0]!.declaredTotal = 2;
    input.pages[1]!.declaredTotal = 3;
    input.pages[1]!.declaredCount = 3;
    input.pages[1]!.declaredPages = 3;
    expect(evaluate(input).derivedAnomalyCodes).toEqual(["TOTAL_CHANGED"]);

    input.artifacts[1]!.channelId = "medical";
    input.pages[1]!.channelId = "medical";
    input.pages[1]!.anomalyCodes = [];
    input.pages[0]!.nextPageSignalAfter = null;
    input.pages[0]!.termination = "NEXT_ABSENT";
    expect(evaluate(input, ["social", "medical"]).derivedAnomalyCodes).toEqual([]);
  });

  it("does not compare repeated fingerprints or returned pages across different channels", () => {
    const input = evidence();
    addPage(input, { body: input.artifacts[0]!.body as string, rawJobIds: ["a", "b"], validJobIds: ["a", "b"] });
    input.artifacts[1]!.channelId = "medical";
    input.pages[1]!.channelId = "medical";
    input.pages[0]!.nextPageSignalAfter = null;
    input.pages[0]!.termination = "NEXT_ABSENT";
    input.pages[1]!.nextPageSignalAfter = "medical-page-2";
    input.pages[1]!.termination = "ABORTED";
    expect(evaluate(input, ["social", "medical"]).derivedAnomalyCodes).toEqual([]);
  });

  it("does not allow a later page to hide previously declared evidence", () => {
    const input = evidence();
    addPage(input, { body: '{"ids":["c"]}', anomalyCodes: ["TOTAL_CHANGED"] });
    input.pages[0]!.declaredTotal = 2;
    input.pages[1]!.declaredTotal = null;
    expect(evaluate(input).derivedAnomalyCodes).toEqual(["TOTAL_CHANGED"]);
  });

  it("allows explicit official zero only on the first page and rejects an intermediate empty page", () => {
    const zero = evidence('{"total":0,"ids":[]}');
    zero.pages[0]!.rawJobIds = [];
    zero.pages[0]!.validJobIds = [];
    zero.pages[0]!.declaredTotal = 0;
    zero.pages[0]!.termination = "EMPTY_PAGE";
    zero.declaredCompleteness!.value = 0;
    zero.fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
    expect(evaluate(zero)).toMatchObject({ safeCompleteness: true, verifiedEligible: true });

    const intermediate = evidence();
    addPage(intermediate, { body: '{"ids":[]}', rawJobIds: [], validJobIds: [],
      anomalyCodes: ["INTERMEDIATE_EMPTY_PAGE"] });
    intermediate.pages[1]!.nextPageSignalAfter = "page-3";
    intermediate.pages[1]!.termination = "ABORTED";
    expect(evaluate(intermediate)).toMatchObject({ safeCompleteness: false, verifiedEligible: false });

    const unlabeledZero = evidence('{"ids":[]}');
    unlabeledZero.pages[0]!.rawJobIds = [];
    unlabeledZero.pages[0]!.validJobIds = [];
    unlabeledZero.pages[0]!.declaredTotal = 0;
    unlabeledZero.pages[0]!.termination = "NEXT_ABSENT";
    unlabeledZero.declaredCompleteness = undefined;
    unlabeledZero.fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
    expect(() => evaluate(unlabeledZero)).toThrow(/official zero/i);

    const wrongZeroTermination = evidence('{"total":0,"ids":[]}');
    wrongZeroTermination.pages[0]!.rawJobIds = [];
    wrongZeroTermination.pages[0]!.validJobIds = [];
    wrongZeroTermination.pages[0]!.declaredTotal = 0;
    wrongZeroTermination.pages[0]!.termination = "NEXT_ABSENT";
    wrongZeroTermination.declaredCompleteness!.value = 0;
    wrongZeroTermination.fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
    expect(() => evaluate(wrongZeroTermination)).toThrow(/EMPTY_PAGE|official zero/i);
  });

  it.each(["ABORTED", "FAILED"] as const)(
    "allows an empty first page with %s only as a non-certifying terminal",
    (termination) => {
      const input = evidence('{"ids":[]}');
      input.pages[0]!.rawJobIds = [];
      input.pages[0]!.validJobIds = [];
      input.pages[0]!.declaredTotal = null;
      input.pages[0]!.nextPageSignalBefore = null;
      input.pages[0]!.nextPageSignalAfter = null;
      input.pages[0]!.termination = termination;
      input.declaredCompleteness = undefined;
      input.fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
      expect(evaluate(input)).toMatchObject({ safeCompleteness: false, verifiedEligible: false });
    }
  );

  it("rejects unsafe or inconsistent terminal events", () => {
    const limited = evidence();
    limited.pages[0]!.termination = "MAX_PAGE_LIMIT";
    limited.pages[0]!.nextPageSignalAfter = "page-2";
    limited.pages[0]!.anomalyCodes = ["MAX_PAGES_WITH_NEXT"];
    expect(evaluate(limited)).toMatchObject({ safeCompleteness: false, verifiedEligible: false });

    const nextAbsent = evidence();
    nextAbsent.pages[0]!.termination = "NEXT_ABSENT";
    nextAbsent.pages[0]!.nextPageSignalAfter = "page-2";
    expect(() => evaluate(nextAbsent)).toThrow(/NEXT_ABSENT.*next/i);

    const totalReached = evidence();
    totalReached.pages[0]!.termination = "DECLARED_TOTAL_REACHED";
    totalReached.pages[0]!.declaredTotal = 3;
    expect(() => evaluate(totalReached)).toThrow(/DECLARED_TOTAL_REACHED.*count/i);
  });

  it("derives a missing expected channel without inventing a visited channel", () => {
    const input = evidence();
    const result = evaluate(input, ["social", "medical"]);
    expect(result.visitedChannelIds).toEqual(["social"]);
    expect(result.derivedAnomalyCodes).toEqual(["EXPECTED_CHANNEL_NOT_VISITED"]);
    expect(result.pages[0]!.anomalyCodes).toEqual([]);
    expect(result.pages.some((page) => page.channelId === "medical")).toBe(false);
  });

  it("rejects omitted and extra caller anomaly labels", () => {
    const omitted = evidence();
    omitted.pages[0]!.nextPageSignalAfter = "page-2";
    omitted.pages[0]!.returnedPage = 0;
    omitted.pages[0]!.termination = "ABORTED";
    expect(() => evaluate(omitted)).toThrow(/caller anomaly.*canonical/i);

    const extra = evidence();
    extra.pages[0]!.anomalyCodes = ["TOTAL_CHANGED"];
    expect(() => evaluate(extra)).toThrow(/caller anomaly.*canonical/i);

    const duplicate = evidence();
    duplicate.pages[0]!.returnedPage = 0;
    duplicate.pages[0]!.nextPageSignalAfter = "page-2";
    duplicate.pages[0]!.termination = "ABORTED";
    duplicate.pages[0]!.anomalyCodes = ["RETURNED_PAGE_MISMATCH", "RETURNED_PAGE_MISMATCH"];
    expect(() => evaluate(duplicate)).toThrow(/caller anomaly.*canonical/i);
  });

  it("hashes ID sets independent of order and page traces sensitive to sequence", () => {
    const first = evaluate(evidence());
    const reordered = evidence();
    reordered.pages[0]!.rawJobIds.reverse();
    reordered.pages[0]!.validJobIds.reverse();
    const second = evaluate(reordered);
    expect(second.pages[0]!.rawJobIdSetSha256).toBe(first.pages[0]!.rawJobIdSetSha256);
    expect(second.pages[0]!.validJobIdSetSha256).toBe(first.pages[0]!.validJobIdSetSha256);

    const two = evidence();
    addPage(two, { body: '{"ids":["c"]}' });
    const forward = evaluate(two).paginationTraceSha256;
    const reversed = evidence('{"ids":["c"]}');
    reversed.pages[0]!.rawJobIds = ["c"];
    reversed.pages[0]!.validJobIds = ["c"];
    reversed.pages[0]!.declaredTotal = 2;
    addPage(reversed, { body: '{"total":2,"ids":["a","b"]}', rawJobIds: ["a", "b"], validJobIds: ["a", "b"] });
    expect(evaluate(reversed).paginationTraceSha256).not.toBe(forward);
  });

  it("never uses GLOBAL_UNFILTERED totals to certify filtered output", () => {
    const input = evidence();
    delete input.artifacts[0]!.channelId;
    delete input.pages[0]!.channelId;
    const { channelId: _channelId, ...declared } = input.declaredCompleteness!;
    input.declaredCompleteness = { ...declared, scope: "GLOBAL_UNFILTERED" };
    expect(evaluate(input, [], true)).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
  });

  it("does not certify a trace that has no declared evidence scope", () => {
    const input = evidence();
    input.pages[0]!.termination = "NEXT_ABSENT";
    input.declaredCompleteness = undefined;
    expect(evaluate(input)).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
  });

  it.each(["OFFICIAL_TOTAL_PAGES", "COMPLETE_PAGE_TRAVERSAL"] as const)(
    "requires %s value to equal actual pages in declared scope",
    (kind) => {
      const input = evidence();
      input.pages[0]!.termination = "NEXT_ABSENT";
      input.declaredCompleteness!.kind = kind;
      input.declaredCompleteness!.value = 2;
      expect(evaluate(input)).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
      input.declaredCompleteness!.value = 1;
      if (kind === "OFFICIAL_TOTAL_PAGES") input.pages[0]!.declaredPages = 1;
      expect(evaluate(input)).toMatchObject({ safeCompleteness: true, verifiedEligible: true });
    }
  );

  it("does not let one CHANNEL declaration certify a multi-channel source", () => {
    const input = evidence();
    input.pages[0]!.termination = "NEXT_ABSENT";
    addPage(input, { body: '{"ids":["m"]}' });
    input.pages[0]!.nextPageSignalAfter = null;
    input.pages[0]!.termination = "NEXT_ABSENT";
    input.artifacts[1]!.channelId = "medical";
    input.pages[1]!.channelId = "medical";
    input.pages[1]!.declaredTotal = 1;
    input.declaredCompleteness!.kind = "OFFICIAL_TOTAL_PAGES";
    input.declaredCompleteness!.value = 1;
    expect(evaluate(input, ["social", "medical"])).toMatchObject({
      safeCompleteness: true, verifiedEligible: false
    });
  });

  it("allows SOURCE page declarations to cover the source aggregate", () => {
    const input = evidence();
    input.pages[0]!.termination = "NEXT_ABSENT";
    addPage(input, { body: '{"ids":["m"]}' });
    input.pages[0]!.nextPageSignalAfter = null;
    input.pages[0]!.termination = "NEXT_ABSENT";
    input.artifacts[1]!.channelId = "medical";
    input.pages[1]!.channelId = "medical";
    input.pages[1]!.declaredTotal = 1;
    input.artifacts.push({
      ...input.artifacts[0]!, id: "source-total", logicalKey: "source-total", channelId: undefined,
      body: '{"pages":2}', extractorLocator: "$.pages"
    });
    input.declaredCompleteness = {
      kind: "COMPLETE_PAGE_TRAVERSAL", value: 2, artifactLogicalKey: "source-total",
      extractorLocator: "$.pages", scope: "SOURCE"
    };
    expect(evaluate(input, ["social", "medical"])).toMatchObject({
      safeCompleteness: true, verifiedEligible: true
    });
  });

  it("derives cross-page cursor, next-signal, offset, and page chain anomalies", () => {
    const input = evidence();
    addPage(input, { body: '{"ids":["c"]}', anomalyCodes: [
      "CURSOR_NOT_ADVANCING", "OFFSET_NOT_ADVANCING", "RETURNED_PAGE_MISMATCH"
    ] });
    input.pages[0]!.termination = "CONTINUE" as never;
    input.pages[0]!.returnedCursor = "cursor-2";
    input.pages[0]!.requestedOffset = 10;
    input.pages[0]!.returnedOffset = 11;
    input.pages[0]!.anomalyCodes = ["OFFSET_NOT_ADVANCING"];
    input.pages[1]!.requestedCursor = "wrong-cursor";
    input.pages[1]!.nextPageSignalBefore = "wrong-next";
    input.pages[1]!.requestedOffset = 10;
    input.pages[1]!.returnedOffset = 10;
    input.pages[1]!.requestedPage = 1;
    input.pages[1]!.returnedPage = 1;
    expect(evaluate(input).derivedAnomalyCodes).toEqual([
      "CURSOR_NOT_ADVANCING", "OFFSET_NOT_ADVANCING", "RETURNED_PAGE_MISMATCH"
    ]);
  });

  it("allows response cursor and offset to echo the current request when the next request advances", () => {
    const input = evidence();
    addPage(input, { body: '{"ids":["c"]}' });
    input.pages[0]!.requestedCursor = "cursor-1";
    input.pages[0]!.returnedCursor = "cursor-2";
    input.pages[0]!.requestedOffset = 0;
    input.pages[0]!.returnedOffset = 0;
    input.pages[1]!.requestedCursor = "cursor-2";
    input.pages[1]!.requestedOffset = 10;
    input.pages[1]!.returnedOffset = 10;
    expect(evaluate(input)).toMatchObject({ safeCompleteness: true, derivedAnomalyCodes: [] });
  });

  it("marks an empty first page with next as intermediate and unsafe", () => {
    const input = evidence('{"ids":[]}');
    input.pages[0]!.rawJobIds = [];
    input.pages[0]!.validJobIds = [];
    input.pages[0]!.declaredTotal = 1;
    input.pages[0]!.termination = "CONTINUE" as never;
    input.pages[0]!.anomalyCodes = ["INTERMEDIATE_EMPTY_PAGE"];
    input.fetchCounts = { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 };
    addPage(input, { body: '{"ids":["a"]}', rawJobIds: ["a"], validJobIds: ["a"] });
    input.pages[1]!.declaredTotal = 1;
    expect(evaluate(input)).toMatchObject({ safeCompleteness: false, verifiedEligible: false });
  });

  it("detects a repeated final page even when the current page has no next signal", () => {
    const input = evidence();
    addPage(input, { body: input.artifacts[0]!.body as string, rawJobIds: ["a", "b"], validJobIds: ["a", "b"],
      anomalyCodes: [
        "RAW_ID_OVERLAP_ACROSS_PAGES", "REPEATED_RESPONSE_FINGERPRINT", "REPEATED_JOB_ID_SET_WITH_NEXT"
      ] });
    input.pages[0]!.termination = "CONTINUE" as never;
    expect(evaluate(input).derivedAnomalyCodes).toEqual([
      "RAW_ID_OVERLAP_ACROSS_PAGES", "REPEATED_JOB_ID_SET_WITH_NEXT", "REPEATED_RESPONSE_FINGERPRINT"
    ]);
  });

  it("requires CONTINUE only on non-final pages and a safe terminal event on the last page", () => {
    const nonfinal = evidence();
    addPage(nonfinal, { body: '{"ids":["c"]}' });
    nonfinal.pages[0]!.termination = "DECLARED_TOTAL_REACHED";
    expect(() => evaluate(nonfinal)).toThrow(/non-final.*CONTINUE/i);

    const final = evidence();
    final.pages[0]!.termination = "CONTINUE" as never;
    expect(() => evaluate(final)).toThrow(/last|final.*CONTINUE/i);
  });

  it("rejects an unexpected visited channel when expected channels are explicit", () => {
    expect(() => evaluate(evidence(), ["medical"])).toThrow(/unexpected.*channel/i);
  });

  it("treats an empty expected-channel set as unchannelled-only", () => {
    expect(() => evaluate(evidence(), [])).toThrow(/unexpected.*channel|unchannelled/i);
  });

  it("cannot omit an established cursor, offset, or page-number dimension on the next page", () => {
    const cursor = evidence();
    addPage(cursor, { body: '{"ids":["c"]}', anomalyCodes: ["CURSOR_NOT_ADVANCING"] });
    cursor.pages[0]!.returnedCursor = "cursor-2";
    cursor.pages[1]!.requestedCursor = null;
    expect(evaluate(cursor).derivedAnomalyCodes).toEqual(["CURSOR_NOT_ADVANCING"]);

    const cursorWithoutReturn = evidence();
    addPage(cursorWithoutReturn, { body: '{"ids":["c"]}', anomalyCodes: ["CURSOR_NOT_ADVANCING"] });
    cursorWithoutReturn.pages[0]!.requestedCursor = "cursor-1";
    cursorWithoutReturn.pages[1]!.requestedCursor = "cursor-2";
    expect(evaluate(cursorWithoutReturn).derivedAnomalyCodes).toEqual(["CURSOR_NOT_ADVANCING"]);

    const offset = evidence();
    addPage(offset, { body: '{"ids":["c"]}', anomalyCodes: ["OFFSET_NOT_ADVANCING"] });
    offset.pages[0]!.requestedOffset = 0;
    offset.pages[0]!.returnedOffset = 10;
    offset.pages[0]!.anomalyCodes = ["OFFSET_NOT_ADVANCING"];
    offset.pages[1]!.requestedOffset = null;
    expect(evaluate(offset).derivedAnomalyCodes).toEqual(["OFFSET_NOT_ADVANCING"]);

    const page = evidence();
    addPage(page, { body: '{"ids":["c"]}', anomalyCodes: ["RETURNED_PAGE_MISMATCH"] });
    page.pages[1]!.requestedPage = null;
    page.pages[1]!.returnedPage = null;
    expect(evaluate(page).derivedAnomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);

    const incompletePage = evidence();
    addPage(incompletePage, { body: '{"ids":["c"]}' });
    incompletePage.pages[0]!.returnedPage = null;
    incompletePage.pages[0]!.anomalyCodes = ["RETURNED_PAGE_MISMATCH"];
    expect(evaluate(incompletePage).derivedAnomalyCodes).toEqual(["RETURNED_PAGE_MISMATCH"]);
  });

  it("requires OFFICIAL_TOTAL_PAGES to be present on the referenced artifact page", () => {
    const missing = evidence();
    missing.pages[0]!.termination = "NEXT_ABSENT";
    missing.declaredCompleteness!.kind = "OFFICIAL_TOTAL_PAGES";
    missing.declaredCompleteness!.value = 1;
    expect(evaluate(missing)).toMatchObject({ safeCompleteness: true, verifiedEligible: false });

    const mismatch = evidence();
    mismatch.pages[0]!.termination = "NEXT_ABSENT";
    mismatch.pages[0]!.declaredPages = 2;
    mismatch.declaredCompleteness!.kind = "OFFICIAL_TOTAL_PAGES";
    mismatch.declaredCompleteness!.value = 1;
    expect(evaluate(mismatch)).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
  });
});
