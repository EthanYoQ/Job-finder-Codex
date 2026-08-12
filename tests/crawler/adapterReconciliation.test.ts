import { describe, expect, it } from "vitest";
import { officialJsonAdapter } from "../../src/crawler/adapters/officialJson";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { assertAdapterReconciliation } from "../../src/crawler/adapters/reconciliation";

const meta = {
  company: { id: "company-1", officialChineseName: "测试公司" },
  source: { id: "source-1", companyId: "company-1", kind: "SOCIAL" as const,
    atsKind: "OFFICIAL_JSON" as const, officialEntryUrl: "https://jobs.example.test/", status: "VERIFIED_SCRAPABLE" as const },
  capturedAt: "2026-07-10T00:00:00.000Z"
};
const json = { fields: { officialTitle: "title", officialUrl: "url", locationRaw: "location" } };
const job = (id: string, title = "Engineer") => ({ id, title, url: `https://jobs.example.test/${id}`, location: "上海" });

describe("adapter reconciliation ledger", () => {
  it("conserves JSON rows and records typed validation loss", () => {
    const result = officialJsonAdapter.extract({ ...meta, payload: [job("1"), { title: "missing" }, "not-an-object"], json });
    expect(result.reconciliation!).toMatchObject({ rawInputCount: 3, parsedCount: 2, validBeforeDedupeCount: 1,
      dedupeInputCount: 1, dedupeOutputCount: 1 });
    expect(result.reconciliation!.adapterLosses).toEqual([
      { stage: "VALIDATION", reason: "URL_INVALID", rawIndex: 1 },
      { stage: "PARSE", reason: "RAW_ROW_NOT_OBJECT", rawIndex: 2 }
    ]);
  });

  it("uses deterministic collision winners and an order-independent canonical output hash", () => {
    const a = job("same", "Zulu");
    const b = job("same", "Alpha");
    const first = officialJsonAdapter.extract({ ...meta, payload: [a, b], json });
    const second = officialJsonAdapter.extract({ ...meta, payload: [b, a], json });
    expect(first.reconciliation!.dedupeOutputCount).toBe(1);
    expect(first.reconciliation!.collisionGroups).toHaveLength(1);
    expect(first.jobs[0]?.officialTitle).toBe("Alpha");
    expect(second.jobs[0]?.officialTitle).toBe("Alpha");
    expect(first.reconciliation!.outputJobKeySetSha256).toBe(second.reconciliation!.outputJobKeySetSha256);
  });

  it("conserves HTML selector rows instead of silently flatMap-dropping them", () => {
    const result = htmlTableAdapter.extract({ ...meta, source: { ...meta.source, atsKind: "OFFICIAL_HTML" },
      html: `<div class="row"><a href="/1">One</a><span>上海</span></div><div class="row"><a>Bad</a></div>`,
      table: { rowSelector: ".row", fields: { officialTitle: { selector: "a" }, officialUrl: { selector: "a", attribute: "href" }, locationRaw: { selector: "span" } } } });
    expect(result.reconciliation!.rawInputCount).toBe(2);
    expect(result.reconciliation!.validBeforeDedupeCount + result.reconciliation!.adapterLosses.length).toBe(2);
  });

  it("rejects caller-only VERIFIED zero", () => {
    const result = officialJsonAdapter.extract({ ...meta, payload: [], json,
      completeness: { completenessStatus: "VERIFIED", expectedJobCount: 0, completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT" } });
    expect(result.status).toBe("FAILED");
  });

  it("records credential-shaped output URLs as typed validation loss", () => {
    const result = officialJsonAdapter.extract({ ...meta, payload: [{ title: "Bad", url: "https://user:placeholder@jobs.example.test/1?token=secret", location: "上海" }], json });
    expect(result.status).toBe("FAILED");
    expect(result.reconciliation!.adapterLosses).toEqual([{ stage: "VALIDATION", reason: "SENSITIVE_OUTPUT", rawIndex: 0 }]);
    expect(JSON.stringify(result.reconciliation)).not.toMatch(/password|secret/);
  });

  it("rejects zero evidence that omits the strict D1 and provenance contract", async () => {
    const plan = { company: meta.company, source: meta.source, adapterId: "official-json" as const, json };
    const fetchEvidence = { fetchCounts: { rawCount: 0, parsedCount: 0, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 0 },
      declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 0 }, artifacts: [], pages: [], fetchLosses: [] } as never;
    const result = await runSourceCrawl(plan as never, { fetch: async () => ({ ok: true, capturedAt: meta.capturedAt, payload: [], fetchEvidence }) });
    expect(result.status).toBe("FAILED");
    expect(result.truth).toEqual({ transportSuccess: true, adapterSuccess: false, completenessVerified: false });
    expect(result.fetchEvidence).toBe(fetchEvidence);
  });

  it("fails runSource reconciliation on fetch-valid mismatch and preserves evidence references", async () => {
    const plan = { company: meta.company, source: meta.source, adapterId: "official-json" as const, json };
    const fetchEvidence = { fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 },
      declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 2 }, artifacts: [], pages: [], fetchLosses: [] } as never;
    const paginationEvaluation = { safeToPromoteCompleteness: false } as never;
    const result = await runSourceCrawl(plan as never, { fetch: async () => ({ ok: true, capturedAt: meta.capturedAt,
      payload: [job("1")], fetchEvidence, paginationEvaluation }) });
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") throw new Error("expected failure");
    expect(result.failureReason).toMatch(/reconciliation/i);
    expect(result.fetchEvidence).toBe(fetchEvidence);
    expect(result.paginationEvaluation).toBe(paginationEvaluation);
    expect(result.reconciliation!.rawInputCount).toBe(1);
  });

  it.each([
    ["category", { category: "not-a-category" }, "CATEGORY_INVALID"],
    ["date", { published: "yesterday" }, "DATE_INVALID"],
    ["cities", { cities: [] }, "CITIES_INVALID"]
  ] as const)("records present-invalid %s with its typed reason", (_field, extra, reason) => {
    const configured = { fields: { ...json.fields, category: "category", officialPublishedAt: "published", cities: "cities" }, defaultCategory: "其他" as const };
    const result = officialJsonAdapter.extract({ ...meta, payload: [{ ...job("typed"), category: "其他", published: meta.capturedAt, cities: ["上海"], ...extra }], json: configured });
    expect(result.status).toBe("FAILED");
    expect(result.reconciliation!.adapterLosses[0]?.reason).toBe(reason);
  });

  it.each([
    ["source id", { id: "token%253Dsecret" }],
    ["title", { title: "clientSecret＝hidden" }],
    ["location", { location: "cookie%3Dhidden" }],
    ["URL path", { url: "https://jobs.example.test/token%253Dhidden" }],
    ["URL hash", { url: "https://jobs.example.test/1#authorization=hidden" }]
  ])("rejects bounded decoded sensitive %s without leaking it to the ledger", (_label, extra) => {
    const result = officialJsonAdapter.extract({ ...meta, payload: [{ ...job("safe"), ...extra }], json: { fields: { ...json.fields, sourceJobId: "id" } } });
    expect(result.status).toBe("FAILED");
    expect(result.reconciliation!.adapterLosses[0]?.reason).toBe("SENSITIVE_OUTPUT");
    expect(JSON.stringify(result.reconciliation)).not.toMatch(/hidden|clientSecret|authorization/iu);
    expect(result.reconciliation).not.toHaveProperty("outputJobKeys");
  });

  it("uses UTF-8 byte ordering for unicode collision winners and reorder stability", () => {
    const left = { ...job("same", "\u{10000}"), url: "https://jobs.example.test/same" };
    const right = { ...job("same", "\uE000"), url: "https://jobs.example.test/same" };
    const a = officialJsonAdapter.extract({ ...meta, payload: [left, right], json: { fields: { ...json.fields, sourceJobId: "id" } } });
    const b = officialJsonAdapter.extract({ ...meta, payload: [right, left], json: { fields: { ...json.fields, sourceJobId: "id" } } });
    expect(a.jobs[0]?.officialTitle).toBe("\uE000");
    expect(b.jobs[0]?.officialTitle).toBe("\uE000");
    expect(a.reconciliation!.outputJobKeyCommitments).toEqual(b.reconciliation!.outputJobKeyCommitments);
  });

  it("strict validator rejects any ledger tamper", () => {
    const result = officialJsonAdapter.extract({ ...meta, payload: [job("same", "Zulu"), job("same", "Alpha")], json: { fields: { ...json.fields, sourceJobId: "id" } } });
    expect(() => assertAdapterReconciliation(result)).not.toThrow();
    for (const mutate of [
      (copy: any) => { copy.rawInputCount += 1; },
      (copy: any) => { copy.outputJobKeySetSha256 = "0".repeat(64); },
      (copy: any) => { copy.collisionGroups[0].winnerKeySha256 = "0".repeat(64); },
      (copy: any) => { copy.collisionGroups[0].droppedCount = 0; }
    ]) {
      const tampered = structuredClone(result.reconciliation!); mutate(tampered);
      expect(() => assertAdapterReconciliation({ ...result, reconciliation: tampered })).toThrow(/reconciliation/i);
    }
  });

  it.each(["official-json", "html-table"] as const)("rejects a sensitive input.source.id in %s before normalized identity or ledger output", (kind) => {
    const source = { ...meta.source, id: "source-token%253Dhidden" };
    const result = kind === "official-json"
      ? officialJsonAdapter.extract({ ...meta, source, payload: [job("safe")], json })
      : htmlTableAdapter.extract({ ...meta, source: { ...source, atsKind: "OFFICIAL_HTML" }, html: `<div class="row"><a href="/1">Safe</a><span>上海</span></div>`,
        table: { rowSelector: ".row", fields: { officialTitle: { selector: "a" }, officialUrl: { selector: "a", attribute: "href" }, locationRaw: { selector: "span" } } } });
    expect(result.status).toBe("FAILED");
    expect(result.jobs).toEqual([]);
    expect(result.reconciliation!.adapterLosses[0]?.reason).toBe("SENSITIVE_OUTPUT");
    expect(JSON.stringify(result)).not.toContain("hidden");
  });

  it("accepts benign identity words without assignment syntax", () => {
    const result = officialJsonAdapter.extract({ ...meta, source: { ...meta.source, id: "source-token-platform" },
      company: { id: "company-secretary", officialChineseName: "认证平台公司" }, payload: [job("safe")], json });
    expect(result.status).toBe("SUCCESS");
  });

  it.each([
    ["company id", { company: { id: "company-apiKey%253Dhidden", officialChineseName: "测试公司" } }],
    ["company name", { company: { id: "company-safe", officialChineseName: "clientSecret＝hidden" } }],
    ["source company id", { source: { ...meta.source, companyId: "company-token%253Dhidden" } }]
  ])("rejects sensitive normalized identity metadata in %s", (_label, override) => {
    const result = officialJsonAdapter.extract({ ...meta, ...override, payload: [job("safe")], json });
    expect(result.status).toBe("FAILED");
    expect(result.reconciliation!.adapterLosses[0]?.reason).toBe("SENSITIVE_OUTPUT");
    expect(JSON.stringify(result)).not.toContain("hidden");
  });
});
