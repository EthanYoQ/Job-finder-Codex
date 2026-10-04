import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { servierIndependentDetailScope, servierDetailScope, assertServierUnknownLifecyclePreserved,
  SERVIER_MOKA_CAMPAIGN } from "../../src/crawler/servierMokaScope";
import { createMokaSourceFetch, type MokaHttpClient } from "../../src/crawler/mokaSourceFetch";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";

const ID = "00000000-0000-4000-8000-000000000001", IV = "0123456789abcdef", KEY = "abcdef0123456789";
const NOW = "2026-10-03T05:00:00.000Z";
function raw(): Record<string, unknown> {
  return { id: ID, title: "岗位", orgId: "shiweiya", status: "open", publishedAt: "2026-09-30T14:41:09", showIsCampus: false };
}
function detail(): Record<string, unknown> {
  return { ...raw(), showIsCampus: true, closedAt: null,
    jobDescription: "Official complete role description and responsibilities for this open posting.",
    locations: [], locDepCampusList: [{ locationIds: [] }], customFields: {} };
}
const identity = { id: ID, title: "岗位" };
function scope(changes: Record<string, unknown>) { return servierIndependentDetailScope(identity, { ...detail(), ...changes }); }
function encrypted(value: unknown): string {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(KEY), Buffer.from(IV));
  return JSON.stringify({ data: cipher.update(JSON.stringify(value), "utf8", "base64") + cipher.final("base64"), necromancer: KEY });
}
async function unknownFixture() {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-servier-china-social")!;
  const http: MokaHttpClient = async request => ({ status: 200, finalUrl: request.url, capturedAt: NOW,
    contentType: request.method === "GET" ? "text/html" : "application/json",
    body: request.method === "GET" ? `<input id="init-data" value='${JSON.stringify({ aesIv: IV, mode: "social", siteId: "47734", org: { id: "shiweiya" } })}'>`
      : request.url.endsWith("jobs/v2") ? encrypted({ success: true, data: { jobStats: { orgId: "shiweiya", total: 1 }, jobs: [raw()] } })
      : encrypted({ success: true, data: detail() }) });
  const fetched = await createMokaSourceFetch({ http, now: () => new Date(NOW) })(plan);
  if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Synthetic UNKNOWN fixture must retain complete original evidence");
  const previous: NormalizedJobRecord = { sourceId: plan.source.id, companyId: plan.company.id, sourceKind: "SOCIAL", atsKind: "MOKA",
    officialChineseCompanyName: "施维雅", officialTitle: "岗位", sourceJobId: "legacy-id", officialUrl: `${SERVIER_MOKA_CAMPAIGN}#/job/${ID}`,
    locationRaw: "北京", cities: ["北京"], category: "其他", isBaseline: true,
    evidence: { officialEntryUrl: SERVIER_MOKA_CAMPAIGN, capturedAt: NOW } };
  return { plan, evidence: fetched.fetchEvidence, previous };
}

describe("Servier source-local open and reopened activity", () => {
  it.each([
    ["2025-04-28T18:27:54", "2026-07-29T00:00"],
    ["2025-08-12T10:30:30", "2026-05-18T00:00"],
    ["2022-01-25T10:29:10", "2024-05-08T00:00"],
    ["2026-09-01T09:00", "2026-09-01T09:00:01"]
  ])("accepts an open posting reopened after historical close %s → %s without changing originals", (closedAt, openedAt) => {
    const d = { ...detail(), closedAt, openedAt }, r = { ...raw(), closedAt, openedAt };
    const before = JSON.stringify({ r, d });
    expect(servierIndependentDetailScope(identity, d)).toMatchObject({ unknownGeography: true, locations: [] });
    expect(servierDetailScope(r, d)).toMatchObject({ unknownGeography: true, locations: [] });
    expect(JSON.stringify({ r, d })).toBe(before);
  });
  it("keeps never-closed open jobs valid when the list omits activity fields", () => {
    expect(servierDetailScope(raw(), detail())).toMatchObject({ unknownGeography: true });
    expect(scope({ openedAt: "2026-09-30T12:00:11" })).toMatchObject({ unknownGeography: true });
  });
  it("binds sparse list timestamps to exact equivalent minute/zero-second native values", () => {
    const d = { ...detail(), closedAt: "2025-04-28T18:27:00", openedAt: "2026-07-29T00:00" };
    expect(servierDetailScope(raw(), d)).toMatchObject({ unknownGeography: true });
    expect(servierDetailScope({ ...raw(), closedAt: "2025-04-28T18:27", openedAt: "2026-07-29T00:00:00" }, d))
      .toMatchObject({ unknownGeography: true });
  });
  it.each([
    { status: "closed", openedAt: "2026-07-29T00:00", closedAt: "2025-04-28T18:27:54" },
    { status: "pause" },
    { closedAt: "2025-04-28T18:27:54" },
    { closedAt: "2025-04-28T18:27:54", openedAt: null },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2025-04-28T18:27:54" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2025-04-28T18:27" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2026-02-30T00:00" },
    { closedAt: "2025-02-29T18:27:54", openedAt: "2026-07-29T00:00" },
    { closedAt: "2025-04-28T24:00", openedAt: "2026-07-29T00:00" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2026-07-29T00:00:60" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2026-07-29" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2026-07-29T00:00:00Z" },
    { closedAt: "2025-04-28T18:27:54", openedAt: "2026-07-29T00:00:00+08:00" },
    { closedAt: "" }, { closedAt: 0 }, { openedAt: "" }, { openedAt: {} }
  ])("rejects unresolved, contradictory or malformed activity %#", changes => {
    expect(() => scope(changes)).toThrow();
  });
  it.each([
    { closedAt: null }, { closedAt: "2025-04-29T18:27:54" }, { closedAt: "bad" },
    { openedAt: null }, { openedAt: "2026-07-28T00:00" }, { openedAt: "2026-02-30T00:00" }
  ])("rejects supplied list activity conflicting with a valid detail %#", listChanges => {
    const d = { ...detail(), closedAt: "2025-04-28T18:27:54", openedAt: "2026-07-29T00:00" };
    expect(() => servierDetailScope({ ...raw(), ...listChanges }, d)).toThrow(/activity mismatch/);
  });
  it("does not pass a list historical close when the detail omits it", () => {
    expect(() => servierDetailScope({ ...raw(), closedAt: "2025-04-28T18:27:54" }, detail())).toThrow(/activity mismatch/);
  });
});

describe("Servier UNKNOWN historical-job lifecycle URL binding", () => {
  it.each(["", "?locale=zh-CN"])("holds a matching legacy-ID job with exact native URL search '%s'", async search => {
    const f = await unknownFixture();
    const previous = { ...f.previous, officialUrl: `${SERVIER_MOKA_CAMPAIGN}${search}#/job/${ID}` };
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.evidence, [previous]))
      .toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
    const { sourceJobId: _, ...withoutId } = previous;
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.evidence, [withoutId]))
      .toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
  });
  it.each([
    `https://example.com/social-recruitment/shiweiya/47734#/job/${ID}`,
    `http://app.mokahr.com/social-recruitment/shiweiya/47734#/job/${ID}`,
    `https://app.mokahr.com/social-recruitment/shiweiya/47735#/job/${ID}`,
    `https://app.mokahr.com/social-recruitment/servier/47734#/job/${ID}`,
    `${SERVIER_MOKA_CAMPAIGN}/#/job/${ID}`,
    `${SERVIER_MOKA_CAMPAIGN}?locale=en-US#/job/${ID}`,
    `${SERVIER_MOKA_CAMPAIGN}?locale=zh-CN&extra=x#/job/${ID}`,
    `${SERVIER_MOKA_CAMPAIGN}?locale=zh-CN&locale=zh-CN#/job/${ID}`,
    `${SERVIER_MOKA_CAMPAIGN}#/job/${ID}?extra=x`,
    `${SERVIER_MOKA_CAMPAIGN}#/job/${ID}/`,
    `${SERVIER_MOKA_CAMPAIGN}#/job/00000000-0000-4000-8000-000000000002`,
    `https://user@app.mokahr.com/social-recruitment/shiweiya/47734#/job/${ID}`,
    "not-a-url"
  ])("does not broaden the legacy URL fallback to %s", async officialUrl => {
    const f = await unknownFixture();
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.evidence, [{ ...f.previous, officialUrl }])).not.toThrow();
  });
  it.each([ID, `sha256:${createHash("sha256").update(JSON.stringify(ID)).digest("hex")}`])("retains ID-based protection for %s", async sourceJobId => {
    const f = await unknownFixture();
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.evidence,
      [{ ...f.previous, sourceJobId, officialUrl: "https://example.com/legacy" }]))
      .toThrow("SERVIER_PREVIOUS_JOB_GEOGRAPHY_UNKNOWN_PRESERVE_LAST_GOOD");
  });
  it("does not match a different source solely by its job ID or URL", async () => {
    const f = await unknownFixture();
    expect(() => assertServierUnknownLifecyclePreserved(f.plan, f.evidence,
      [{ ...f.previous, sourceJobId: ID, sourceId: "source-other-social" }])).not.toThrow();
  });
});
