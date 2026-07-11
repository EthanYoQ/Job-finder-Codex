import { createCipheriv } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMokaSourceFetch,
  decryptMokaResponse,
  extractMokaInitData,
  type MokaEncryptedResponse,
  type MokaHttpClient,
  type MokaHttpResponse
} from "../../src/crawler/mokaSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const aesIv = "de7c21ed8d6f50fe";
const necromancer = "6e9ecb8e9c6c1a5e";
const capturedAt = "2026-07-08T08:00:00.000Z";
const officialEntryUrl =
  "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/jobs";

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: "company-beigene",
    officialChineseName: "百济神州"
  },
  source: {
    id: "source-beigene-social",
    companyId: "company-beigene",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl,
    officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
};

function htmlWithInitData(initData: object): string {
  return `<input id="init-data" value="${escapeHtml(JSON.stringify(initData))}">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function encryptedResponse(payload: unknown): MokaEncryptedResponse {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(necromancer), Buffer.from(aesIv));
  let data = cipher.update(JSON.stringify(payload), "utf8", "base64");
  data += cipher.final("base64");

  return { data, necromancer };
}

function evidenceResponse(body: string, kind: "entry" | "api"): MokaHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: kind === "entry"
      ? "https://app.mokahr.com/apply/beigene/98934#/jobs"
      : "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2",
    contentType: kind === "entry" ? "text/html; charset=utf-8" : "application/json",
    capturedAt
  };
}

describe("Moka source fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts Moka init data from the hidden input", () => {
    const initData = extractMokaInitData(
      htmlWithInitData({
        aesIv,
        mode: "social",
        siteId: "98934",
        org: { id: "beigene", siteId: 98934, name: "百济神州" }
      })
    );

    expect(initData).toEqual({
      aesIv,
      orgId: "beigene",
      siteId: "98934",
      mode: "social"
    });
  });

  it("decrypts a Moka encrypted response", () => {
    const decrypted = decryptMokaResponse(
      encryptedResponse({ success: true, data: { jobs: [{ id: "job-1" }] } }),
      aesIv
    );

    expect(decrypted).toEqual({ success: true, data: { jobs: [{ id: "job-1" }] } });
  });

  it("fetches Moka jobs and enriches them for the official JSON adapter", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return evidenceResponse(
          htmlWithInitData({
            aesIv,
            mode: "social",
            siteId: "98934",
            org: { id: "beigene", siteId: 98934, name: "百济神州" }
          }),
          "entry"
        );
      }

      return evidenceResponse(
        JSON.stringify(
          encryptedResponse({
            success: true,
            data: {
              jobStats: { total: 1 },
              jobs: [
                {
                  id: "job-1",
                  title: "Research Chief",
                  locations: [{ cityName: "上海市", provinceName: "上海市", country: "中国" }]
                }
              ]
            }
          })
        ),
        "api"
      );
    };

    const fetch = createMokaSourceFetch({
      http,
      now: () => new Date(capturedAt)
    });
    const result = await fetch(plan);

    expect(result).toMatchObject({ ok: true, capturedAt });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected successful Moka payload");
    }

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      url: "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2",
      method: "POST"
    });
    expect(requests[1]?.body).toMatchObject({
      orgId: "beigene",
      siteId: "98934",
      limit: 50,
      offset: 0,
      isCampusJob: false
    });
    expect(result.payload).toMatchObject({
      success: true,
      data: {
        jobs: [
          {
            id: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            title: "Research Chief",
            officialUrl:
              "https://app.mokahr.com/apply/beigene/98934#/job/job-1",
            locationRaw: "上海市",
            cities: ["上海市"]
          }
        ]
      }
    });
    expect(result.completeness).toMatchObject({
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: 1,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: "https://app.mokahr.com/apply/beigene/98934",
      totalPages: 1,
      pageSize: 50,
      pagesVisited: 1
    });
  });

  it("continues Moka pagination until the official total is exhausted", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return evidenceResponse(
          htmlWithInitData({
            aesIv,
            mode: "social",
            siteId: "98934",
            org: { id: "beigene", siteId: 98934, name: "百济神州" }
          }),
          "entry"
        );
      }

      const offset = Number((request.body as { offset?: unknown }).offset);
      const pageJobs = offset === 0
        ? Array.from({ length: 50 }, (_, index) => ({
            id: `job-${index}`,
            title: `Role ${index}`,
            locations: [{ cityName: "上海市" }]
          }))
        : [
            {
              id: "job-50",
              title: "Role 50",
              locations: [{ cityName: "上海市" }]
            }
          ];
      return evidenceResponse(
        JSON.stringify(
          encryptedResponse({
            success: true,
            data: {
              jobStats: { total: 51 },
              jobs: pageJobs
            }
          })
        ),
        "api"
      );
    };

    const fetch = createMokaSourceFetch({
      http,
      now: () => new Date(capturedAt)
    });
    const result = await fetch(plan);

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 51,
        pagesVisited: 2
      }
    });
    expect(
      requests
        .filter((request) => request.method === "POST")
        .map((request) => (request.body as { offset?: unknown }).offset)
    ).toEqual([0, 50]);
  });

  it("carries Moka redirect cookies when using the default HTTP client", async () => {
    const requests: Array<{ url: string; cookie: string; redirect: RequestRedirect | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const headers = new Headers(init?.headers);
        requests.push({ url, cookie: headers.get("cookie") ?? "", redirect: init?.redirect });

        if (url.includes("/apply/beigene/98934") && !headers.get("cookie")?.includes("connect.sid=session")) {
          return new Response("Found. Redirecting to the same Moka path", {
            status: 302,
            headers: [
              ["location", "/apply/beigene/98934?sourceToken=token"],
              ["set-cookie", "connect.sid=session; Path=/; HttpOnly"],
              ["set-cookie", "csrfCk=csrf; Path=/; HttpOnly"]
            ]
          });
        }

        if (url.includes("/apply/beigene/98934")) {
          return new Response(
            htmlWithInitData({
              aesIv,
              mode: "social",
              siteId: "98934",
              org: { id: "beigene", siteId: 98934, name: "百济神州" }
            }),
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }

        if (url.includes("/api/outer/ats-apply/website/jobs/v2")) {
          return new Response(
            JSON.stringify(
              encryptedResponse({
                success: true,
                data: {
                  jobs: [
                    {
                      id: "job-1",
                      title: "Research Chief",
                      locations: [{ cityName: "上海市" }]
                    }
                  ]
                }
              })
            ),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      })
    );

    const fetch = createMokaSourceFetch({ now: () => new Date(capturedAt) });
    const result = await fetch(plan);

    expect(result).toMatchObject({ ok: true, capturedAt });
    expect(
      requests.some(
        (request) =>
          request.url.includes("/apply/beigene/98934") &&
          request.cookie.includes("connect.sid=session")
      )
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.url.includes("/apply/beigene/98934"))
        .every((request) => request.redirect === "manual")
    ).toBe(true);
    expect(
      requests.some(
        (request) =>
          request.url.includes("/api/outer/ats-apply/website/jobs/v2") &&
          request.cookie.includes("connect.sid=session")
      )
    ).toBe(false);
  });

  it("returns a failed fetch result when used on a non-Moka source", async () => {
    const fetch = createMokaSourceFetch({
      http: async () => ({ status: 200, body: "" }),
      now: () => new Date(capturedAt)
    });
    const result = await fetch({
      ...plan,
      source: { ...plan.source, atsKind: "OFFICIAL_JSON" }
    });

    expect(result).toEqual({
      ok: false,
      capturedAt,
      failureReason: "Moka source fetch only supports MOKA sources"
    });
  });
});
