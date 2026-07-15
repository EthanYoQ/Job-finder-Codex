import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpRequest, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-11T06:00:00.000Z";
const ORIGIN = "https://ehr.e-cspc.com:8081";
const ENTRY = `${ORIGIN}/RedseaPlatform/zhaopin/zpChannelQrCode/social/officeWebsite.mob`;

function bindings(...values: Array<[string, "SOCIAL" | "CAMPUS"]>) {
  return values.map(([channelQrId, purpose]) => ({ channelQrId, purpose }));
}

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "cspc", officialChineseName: "石药集团" },
    source: { id: "cspc-social", companyId: "cspc", kind: "SOCIAL", atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE", officialEntryUrl: ENTRY, officialChainEvidenceUrl: ENTRY },
    json: { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title", officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" } },
    officialJsonFetch: {
      kind: "redsea-zp-channel",
      rootId: "cspc",
      channels: bindings(["social", "SOCIAL"], ["campus", "CAMPUS"]),
      paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1",
      ...overrides
    } as never
  };
}

function response(body: string, url: string, type: string, time = NOW, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType: type, capturedAt: time, ...overrides };
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return { REQUEST_ID: id, PUBLISH_NAME: `Role ${id}`, work_place: "上海市", ...overrides };
}

function client(apiByChannel: Record<string, unknown[]> = { social: [row("s1")], campus: [row("c1")] }) {
  return async (request: OfficialJsonHttpRequest): Promise<OfficialJsonHttpResponse> => {
    if (request.url.includes("officeWebsite.mob")) return { ...response("<html>entry</html>", request.url, "text/html"), setCookie: ["JSESSIONID=opaque-session; Secure"] };
    if (request.url.includes("officePage.mob")) return response("<html>list</html>", request.url, "text/html");
    const channel = new URLSearchParams(request.body).get("channelQrId")!;
    return response(JSON.stringify({ state: "1", total: "", jsonList: apiByChannel[channel] ?? [] }), request.url, "application/json");
  };
}

describe("Redsea channel evidence instrumentation", () => {
  it("captures exact artifacts for the social channel and certifies its unpaginated response", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client() })(plan());
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "VERIFIED", pagesVisited: 1 },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 },
        pages: [{ requestedCursor: "social", termination: "NEXT_ABSENT" }]
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.artifacts.map((artifact) => [artifact.logicalKey, artifact.kind])).toEqual([
      ["redsea-social-entry", "OFFICIAL_COMPANY_PAGE"],
      ["redsea-social-list", "OFFICIAL_COMPANY_PAGE"],
      ["redsea-social-api", "PAGINATION_PAGE"]
    ]);
    expect(JSON.stringify(result)).not.toContain("opaque-session");
    expect(result.fetchEvidence.artifacts[0]).toMatchObject({ bodyRepresentation: "EXACT", body: "<html>entry</html>" });
  });

  it("redacts credential-bearing response bodies while keeping cookie-only transport metadata out of evidence", async () => {
    const secret = "opaque-body-secret";
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      if (request.url.includes("officeWebsite.mob")) return { ...response(`<meta name="token" content="${secret}">`, request.url, "text/html"), setCookie: ["JSESSIONID=transport-only; Secure"] };
      return client()(request);
    }})(plan());
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("transport-only");
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({ bodyRepresentation: "REDACTED", rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/), redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL" }] });
  });

  it("retains exact evidence and a noncertifying terminal for an empty response without an official zero", async () => {
    const fetched = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client({ social: [] }) })(plan());
    expect(fetched).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { fetchCounts: { rawCount: 0 }, pages: [{ channelId: "social", termination: "ABORTED", anomalyCodes: [] }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
    if (!fetched.fetchEvidence) throw new Error("missing evidence");
    expect(fetched.fetchEvidence.artifacts).toHaveLength(3);
  });

  it("accounts every invalid, duplicate, conflicting and out-of-scope raw row", async () => {
    const rows = [row("a"), null, row("a"), row("a", { PUBLISH_NAME: "Conflict" }), row("foreign", { work_place: "Boston, United States" }), row("unsafe/../id")];
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client({ social: rows }) })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 6, parsedCount: 5, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 4 } } });
    if (!result.fetchEvidence) throw new Error("missing evidence");
    expect(result.fetchEvidence.fetchLosses.map((loss) => loss.details.code)).toEqual(["NON_OBJECT_RECORD", "DUPLICATE_OFFICIAL_ID", "CONFLICTING_OFFICIAL_ID", "OUT_OF_SCOPE", "UNSAFE_OFFICIAL_ID"]);
  });

  it("retains safe artifacts on an API failure without leaking upstream messages", async () => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      if (!request.url.includes("queryPostList.mob")) return client()(request);
      return response(JSON.stringify({ state: "0", meg: "Bearer example-placeholder", jsonList: [] }), request.url, "application/json");
    }})(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Redsea API state is unsuccessful", fetchEvidence: { artifacts: [{}, {}, { bodyRepresentation: "REDACTED" }], pages: [{ termination: "FAILED" }] } });
    expect(JSON.stringify(result)).not.toContain("example-placeholder");
  });

  it("rejects recursive duplicate JSON keys and unsafe config before trusting transport", async () => {
    const duplicate = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => request.url.includes("queryPostList.mob")
      ? response('{"state":"1","jsonList":[{"REQUEST_ID":"a","PUBLISH_NAME":"A","work_place":"上海","meta":{"x":1,"x":2}}]}', request.url, "application/json")
      : client()(request) })(plan());
    expect(duplicate).toMatchObject({ ok: false, failureReason: "Redsea API response schema is invalid", fetchEvidence: expect.any(Object) });

    let calls = 0;
    const unsafe = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan({ channels: bindings(["social", "SOCIAL"], ["../campus", "CAMPUS"]) }));
    expect(unsafe).toMatchObject({ ok: false, failureReason: "Redsea channel configuration is invalid" });
    expect(calls).toBe(0);
  });

  it.each([
    ["duplicate channel", { channels: bindings(["social", "SOCIAL"], ["social", "CAMPUS"]) }],
    ["two social channels", { channels: bindings(["social", "SOCIAL"], ["other", "SOCIAL"]) }],
    ["campus only", { channels: bindings(["campus", "CAMPUS"]) }],
    ["unsafe root", { rootId: "token=opaque" }],
    ["wrong sort", { sortName: "other.rank" }],
    ["wrong pagination policy", { paginationPolicy: "TRUST_ME" }]
  ])("rejects unsafe config pre-transport: %s", async (_label, overrides) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan(overrides));
    expect(result).toMatchObject({ ok: false, failureReason: "Redsea channel configuration is invalid" });
    expect(calls).toBe(0);
  });

  it.each([
    ["wrong entry MIME", "entry", { contentType: "application/json" }],
    ["wrong list status", "list", { status: 503 }],
    ["API final URL drift", "api", { finalUrl: "https://evil.example/queryPostList.mob" }],
    ["capture reversal", "api", { capturedAt: "2026-07-11T05:59:59.000Z" }]
  ])("fails closed and retains available evidence for %s", async (_label, target, override) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => {
      const base = await client()(request);
      const kind = request.url.includes("queryPostList") ? "api" : request.url.includes("officePage") ? "list" : "entry";
      return kind === target ? { ...base, ...override } : base;
    }})(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: target === "entry" ? expect.any(Object) : { artifacts: expect.any(Array) } });
  });

  it.each([
    ["missing state", JSON.stringify({ jsonList: [] })],
    ["false state", JSON.stringify({ state: "0", meg: "private-message", jsonList: [] })],
    ["missing list", JSON.stringify({ state: "1" })],
    ["malformed list", JSON.stringify({ state: "1", jsonList: {} })]
  ])("requires strict success state and jsonList without leaking meg: %s", async (_label, body) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request) => request.url.includes("queryPostList")
      ? response(body, request.url, "application/json") : client()(request) })(plan());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.failureReason).toMatch(/^Redsea API/);
    expect(result.failureReason).not.toContain("private-message");
    expect(JSON.stringify(result)).not.toContain("private-message");
  });

  it.each([
    ["HMT", "香港", "OUT_OF_SCOPE"],
    ["foreign", "Tokyo, Japan", "OUT_OF_SCOPE"],
    ["unknown", "Remote", "AMBIGUOUS_SCOPE"]
  ])("accounts non-mainland scope: %s", async (_label, location, code) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client({ social: [row("scope", { work_place: location })] }) })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 }, fetchLosses: [{ details: { code } }] } });
  });

  it("preserves exact evidence references through runSourceCrawl", async () => {
    const fetched = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client() })(plan());
    const result = await runSourceCrawl(plan(), { fetch: async () => fetched });
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
  });
});
