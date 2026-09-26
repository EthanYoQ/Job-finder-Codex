import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpRequest, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-16T00:00:00.000Z";
const ORIGIN = "https://ehr.e-cspc.com:8081";
const SOCIAL = "0beb3022-3214-4333-a2e7-20786c4916d5";
const CAMPUS = "623d3b53-0d75-4649-8d4c-df366532fb58";
const ENTRY = `${ORIGIN}/RedseaPlatform/zhaopin/zpChannelQrCode/${SOCIAL}/officeWebsite.mob`;
type RedseaFixture = {
  social: Array<Record<string, unknown>>;
  campus: Array<Record<string, unknown>>;
};
const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), "src/crawler/fixtures/redsea-social-channel.json"),
  "utf8"
)) as RedseaFixture;

function response(body: string, url: string, contentType: string): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType, capturedAt: NOW };
}

function plan(): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-cspc", officialChineseName: "石药控股集团有限公司" },
    source: {
      id: "source-cspc-social",
      companyId: "company-cspc",
      kind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: ENTRY,
      officialChainEvidenceUrl: "https://www.cspc.cn/hr/index.html"
    },
    json: {
      jobsPath: "jobs",
      fields: {
        sourceJobId: "sourceJobId",
        officialTitle: "title",
        officialUrl: "officialUrl",
        locationRaw: "locationRaw",
        cities: "cities"
      }
    },
    officialJsonFetch: {
      kind: "redsea-zp-channel",
      rootId: "cspc",
      channels: [
        { channelQrId: SOCIAL, purpose: "SOCIAL" },
        { channelQrId: CAMPUS, purpose: "CAMPUS" }
      ],
      paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1"
    } as never
  };
}

function client(requestedChannels: string[], apiOverride?: Record<string, unknown>) {
  return async (request: OfficialJsonHttpRequest): Promise<OfficialJsonHttpResponse> => {
    if (request.url.includes("officeWebsite.mob")) {
      return { ...response("<html>entry</html>", request.url, "text/html"), setCookie: ["JSESSIONID=opaque; Secure"] };
    }
    if (request.url.includes("officePage.mob")) return response("<html>list</html>", request.url, "text/html");
    const channel = new URLSearchParams(request.body).get("channelQrId")!;
    requestedChannels.push(channel);
    return response(JSON.stringify({
      state: "1",
      total: "",
      jsonList: fixture[channel === SOCIAL ? "social" : "campus"],
      ...apiOverride
    }), request.url, "application/json");
  };
}

describe("Redsea social channel policy", () => {
  it("binds only the human-verified social channel into the staged social plan", () => {
    const staged = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-cspc-social");
    if (!staged || staged.adapterId !== "official-json") throw new Error("Expected staged Redsea plan");
    expect(staged?.officialJsonFetch).toMatchObject({
      kind: "redsea-zp-channel",
      channels: [
        { channelQrId: SOCIAL, purpose: "SOCIAL" }
      ],
      paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1"
    });
    expect(staged?.expectedChannels).toEqual([{ channelId: SOCIAL, kind: "SOCIAL" }]);
  });

  it("requests only the social channel, accepts explicit mainland locations and certifies one unpaginated response", async () => {
    const requestedChannels: string[] = [];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: client(requestedChannels)
    })(plan());

    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "VERIFIED", pagesVisited: 1 },
      fetchEvidence: {
        declaredCompleteness: {
          kind: "COMPLETE_PAGE_TRAVERSAL",
          value: 1,
          scope: "CHANNEL",
          channelId: SOCIAL
        },
        fetchCounts: {
          rawCount: fixture.social.length,
          parsedCount: fixture.social.length,
          validCount: fixture.social.length,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        },
        fetchLosses: [],
        pages: [{ channelId: SOCIAL, termination: "NEXT_ABSENT", nextPageSignalAfter: null }]
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    expect(requestedChannels).toEqual([SOCIAL]);
    if (!result.ok || !("payload" in result)) throw new Error("Expected Redsea payload");
    expect((result.payload as { jobs: Array<{ sourceJobId: string }> }).jobs.map(({ sourceJobId }) => sourceJobId))
      .toEqual(fixture.social.map((row) => `${SOCIAL}:${String((row as Record<string, unknown>).REQUEST_ID)}`));
    expect(JSON.stringify(result)).not.toContain("campus-should-never-enter-social");
  });

  it.each([
    ["next-page signal", { hasNext: true }],
    ["larger official total", { total: fixture.social.length + 1 }],
    ["contradictory zero total", { total: 0 }]
  ])("fails closed when a nominally unpaginated response carries %s", async (_label, signal) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: client([], signal)
    })(plan());
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Redsea API pagination signal is unsafe",
      fetchEvidence: { pages: [{ channelId: SOCIAL, termination: "FAILED" }] }
    });
  });

  it("passes the independent crawl truth gate only for the canonical staged social plan", async () => {
    const staged = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-cspc-social");
    if (!staged) throw new Error("Expected staged CSPC plan");
    const fetched = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: client([])
    })(staged);
    const result = await runSourceCrawl(staged, { fetch: async () => fetched });
    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", structuredJobCount: fixture.social.length }
    });
  });

  it.each([
    ["Hong Kong", "OUT_OF_SCOPE"],
    ["Remote", "AMBIGUOUS_SCOPE"]
  ])("keeps an explainable loss for rejected geography %s", async (location, code) => {
    const invalid = [{ REQUEST_ID: "invalid-scope", PUBLISH_NAME: "Role", work_place: location }];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => {
        if (request.url.includes("officeWebsite.mob")) return response("<html>entry</html>", request.url, "text/html");
        if (request.url.includes("officePage.mob")) return response("<html>list</html>", request.url, "text/html");
        return response(JSON.stringify({ state: "1", total: "", jsonList: invalid }), request.url, "application/json");
      }
    })(plan());
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code, field: "location", pageSequence: 0, recordIndex: 0 } }]
      }
    });
  });
});
