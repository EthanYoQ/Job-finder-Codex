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

const servierEntryUrl = "https://www.servier.com.cn/social-recruitment/shiweiya/47734";
const servierCampaignUrl = "https://app.mokahr.com/social-recruitment/shiweiya/47734";
const servierPlan: SourceCrawlPlan = {
  ...plan,
  company: { id: "company-servier-china", officialChineseName: "施维雅中国" },
  source: {
    ...plan.source,
    id: "source-servier-china-social",
    companyId: "company-servier-china",
    officialEntryUrl: servierEntryUrl,
    officialChainEvidenceUrl: servierEntryUrl
  },
  moka: {
    expectedOrgId: "shiweiya",
    expectedSiteId: "47734",
    expectedMode: "social",
    campaignUrl: servierCampaignUrl,
    allowedEntryRedirect: {
      origin: "https://app.mokahr.com",
      pathname: "/social-recruitment/shiweiya/47734"
    },
    hydrateMissingLocationsFromDetail: true
  }
};

const servierPlanWithBoundDetailSiteIdOmission: SourceCrawlPlan = {
  ...servierPlan,
  moka: {
    ...servierPlan.moka!,
    allowDetailSiteIdOmission: true
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

  it("classifies a retryable Servier entry 504 as a safe transport failure", async () => {
    const result = await createMokaSourceFetch({
      http: async () => ({ status: 504, body: "upstream timeout" }),
      now: () => new Date(capturedAt)
    })(servierPlan);

    expect(result).toMatchObject({
      ok: false,
      failureReason: "Official recruitment endpoint was temporarily unavailable (HTTP 504)",
      transportFailure: { code: "OFFICIAL_HTTP_504", retryable: true }
    });
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

  it("binds an official same-domain entry to the exact configured Moka social campaign", async () => {
    const requests: Parameters<MokaHttpClient>[0][] = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv,
            mode: "social",
            siteId: "47734",
            org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      return {
        ...evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: {
            jobStats: { total: 1 },
            jobs: [{ id: "servier-1", title: "医学信息沟通专员", locations: [{ cityName: "北京市", country: "中国" }] }]
          }
        })), "api"),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2"
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(servierPlan);

    expect(result.ok).toBe(true);
    expect(requests[1]).toMatchObject({
      url: "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2",
      headers: { Origin: "https://app.mokahr.com", Referer: servierCampaignUrl },
      body: { orgId: "shiweiya", siteId: "47734", site: "social", isCampusJob: false }
    });
  });

  it.each([
    ["2026-10-16T15:18", "2026-10-16T15:18:00+08:00"],
    ["2026-10-13T15:18", "2026-10-13T15:18:00+08:00"],
    ["2026-07-01T09:30:00", "2026-07-01T09:30:00+08:00"],
    ["2026-07-01T09:30:00.123", "2026-07-01T09:30:00.123+08:00"],
    ["2026-07-01", "2026-07-01T00:00:00+08:00"],
    ["2026-07-01T09:30:00Z", "2026-07-01T09:30:00Z"],
    ["2026-07-01T09:30:00+09:00", "2026-07-01T09:30:00+09:00"],
    ["2026-07-01T09:30:00-04:00", "2026-07-01T09:30:00-04:00"],
    ["2026-07-01T09:30+09:00", "2026-07-01T09:30+09:00"],
    ["2026-13-01T15:18", undefined],
    ["2026-10-16T25:18", undefined],
    ["2026-10-16T15:61", undefined],
    ["not-a-date", undefined],
    ["", undefined],
    [null, undefined]
  ])("normalizes no-zone Moka minute time and preserves existing date behavior: %s", async (publishedAt, expected) => {
    const http: MokaHttpClient = async request => request.method === "GET"
      ? evidenceResponse(htmlWithInitData({
          aesIv, mode: "social", siteId: "98934", org: { id: "beigene", siteId: 98934 }
        }), "entry")
      : evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "date-1", title: "医学专员", publishedAt,
            locations: [{ cityName: "上海市", country: "中国" }] }] }
        })), "api");
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failureReason);
    if (!("payload" in result)) throw new Error("Expected Moka JSON payload");
    expect((result.payload as { data: { jobs: Array<{ officialPublishedAt?: string }> } }).data.jobs[0]!.officialPublishedAt).toBe(expected);
  });

  it("filters Moka jobs by the configured China-calendar recent window and preserves the official date", async () => {
    const recentPlan: SourceCrawlPlan = {
      ...plan,
      moka: {
        expectedOrgId: "beigene",
        expectedSiteId: "98934",
        expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/apply/beigene/98934",
        publishedWithinDays: 183
      }
    };
    const http: MokaHttpClient = async (request) => request.method === "GET"
      ? evidenceResponse(htmlWithInitData({
          aesIv, mode: "social", siteId: "98934", org: { id: "beigene", siteId: 98934 }
        }), "entry")
      : evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: {
            jobStats: { total: 2 },
            jobs: [
              { id: "recent", title: "近期职位", publishedAt: "2026-07-01T09:30:00", locations: [{ cityName: "上海市", country: "中国" }] },
              { id: "stale", title: "过期职位", publishedAt: "2025-01-01T09:30:00", locations: [{ cityName: "北京市", country: "中国" }] }
            ]
          }
        })), "api");

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(recentPlan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 },
        fetchLosses: [expect.objectContaining({ details: expect.objectContaining({ code: "OUTSIDE_RECENT_JOB_WINDOW" }) })]
      },
      payload: { data: { jobs: [{ officialPublishedAt: "2026-07-01T09:30:00+08:00" }] } }
    });
  });

  it.each([
    ["evil subdomain", "https://app.mokahr.com.evil.example/social-recruitment/shiweiya/47734"],
    ["campaign path drift", "https://app.mokahr.com/campus-recruitment/shiweiya/70032"]
  ])("rejects a configured entry redirect with %s", async (_label, finalUrl) => {
    const result = await createMokaSourceFetch({
      http: async () => ({
        ...evidenceResponse(htmlWithInitData({
          aesIv,
          mode: "social",
          siteId: "47734",
          org: { id: "shiweiya", siteId: 47734 }
        }), "entry"),
        finalUrl
      }),
      now: () => new Date(capturedAt)
    })(servierPlan);

    expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("invalid final URL") });
  });

  it("rejects a non-social Moka init mode before requesting any job list", async () => {
    const requests: Parameters<MokaHttpClient>[0][] = [];
    const result = await createMokaSourceFetch({
      http: async (request) => {
        requests.push(request);
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv,
            mode: "campus",
            siteId: "47734",
            org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      },
      now: () => new Date(capturedAt)
    })(servierPlanWithBoundDetailSiteIdOmission);

    expect(result).toMatchObject({
      ok: false,
      failureReason: "Moka init data does not match the bound social campaign"
    });
    expect(requests).toHaveLength(1);
  });

  it("hydrates a missing list location from a campaign-bound encrypted official detail response", async () => {
    const requests: Parameters<MokaHttpClient>[0][] = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "servier-1", title: "医学信息沟通专员" }] }
        })), "api");
      }
      return {
        status: 200,
        body: JSON.stringify(encryptedResponse({
          code: 0,
          success: true,
          data: {
            id: "servier-1",
            orgId: "shiweiya",
            siteId: "47734",
            locations: [{ cityName: "北京市", provinceName: "北京市", country: "中国" }]
          }
        })),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(servierPlan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        artifacts: expect.arrayContaining([
          expect.objectContaining({ logicalKey: "moka-detail-0000-0000", kind: "ATS_API_RESPONSE" })
        ]),
        pages: [{ rawJobIds: [expect.stringMatching(/^sha256:/)], validJobIds: [expect.stringMatching(/^sha256:/)] }],
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 }
      }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected hydrated Moka payload");
    expect(result.payload).toMatchObject({ data: { jobs: [{ locationRaw: "北京市", cities: ["北京市"] }] } });
    expect(requests[2]).toMatchObject({
      url: "https://app.mokahr.com/api/outer/ats-apply/website/job",
      method: "POST",
      headers: { Origin: "https://app.mokahr.com", Referer: servierCampaignUrl },
      body: { orgId: "shiweiya", siteId: "47734", jobId: "servier-1", locale: "zh-CN" }
    });
  });

  it("hydrates two campaign-bound Servier jobs when encrypted details omit siteId and ignores unused prose", async () => {
    const requests: Parameters<MokaHttpClient>[0][] = [];
    const http: MokaHttpClient = async (request) => {
      requests.push(request);
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: {
            jobStats: { total: 2 },
            jobs: [
              { id: "servier-1", title: "医学信息沟通专员" },
              { id: "servier-2", title: "临床项目经理" }
            ]
          }
        })), "api");
      }
      const requestedJobId = (request.body as { jobId?: string } | undefined)?.jobId;
      const cityName = requestedJobId === "servier-1" ? "北京市" : "上海市";
      return {
        status: 200,
        body: JSON.stringify(encryptedResponse({
          success: true,
          data: {
            id: requestedJobId,
            orgId: "shiweiya",
            jobDescription: requestedJobId === "servier-1"
              ? "负责 basic science 能力建设和跨团队协作"
              : "负责项目计划和团队协作",
            locations: [{ cityName, country: "中国" }]
          }
        })),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(
      servierPlanWithBoundDetailSiteIdOmission
    );

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: {
          rawCount: 2,
          parsedCount: 2,
          validCount: 2,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        }
      }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected complete two-job Servier payload");
    expect(result.payload).toMatchObject({
      data: {
        jobs: [
          { locationRaw: "北京市", cities: ["北京市"] },
          { locationRaw: "上海市", cities: ["上海市"] }
        ]
      }
    });
    expect(requests.filter((request) => request.url.endsWith("/job"))).toHaveLength(2);
    expect(requests.filter((request) => request.url.endsWith("/job"))).toEqual([
      expect.objectContaining({ body: { orgId: "shiweiya", siteId: "47734", jobId: "servier-1", locale: "zh-CN" } }),
      expect.objectContaining({ body: { orgId: "shiweiya", siteId: "47734", jobId: "servier-2", locale: "zh-CN" } })
    ]);
  });

  it.each([
    [
      "a returned mismatched siteId",
      { id: "servier-2", orgId: "shiweiya", siteId: "70032", locations: [{ cityName: "上海市", country: "中国" }] },
      "siteId"
    ],
    [
      "credential material in a consumed location",
      { id: "servier-2", orgId: "shiweiya", locations: [{ cityName: "Authorization: Bearer fixture-secret", country: "中国" }] },
      "detail"
    ]
  ])("fails the whole two-job Servier fetch on %s", async (_label, secondDetail, expectedField) => {
    const http: MokaHttpClient = async (request) => {
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: {
            jobStats: { total: 2 },
            jobs: [
              { id: "servier-1", title: "医学信息沟通专员" },
              { id: "servier-2", title: "临床项目经理" }
            ]
          }
        })), "api");
      }
      const requestedJobId = (request.body as { jobId?: string } | undefined)?.jobId;
      const detail = requestedJobId === "servier-1"
        ? { id: "servier-1", orgId: "shiweiya", locations: [{ cityName: "北京市", country: "中国" }] }
        : secondDetail;
      return {
        status: 200,
        body: JSON.stringify(encryptedResponse({ success: true, data: detail })),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(
      servierPlanWithBoundDetailSiteIdOmission
    );

    expect(result).toMatchObject({
      ok: false,
      failureReason: "Moka detail hydration failed closed",
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 },
        fetchLosses: [expect.objectContaining({
          details: { code: "DETAIL_HYDRATION_FAILED", field: expectedField, pageSequence: 0, recordIndex: 1 }
        })]
      }
    });
    expect(result).not.toHaveProperty("payload");
  });

  it.each([
    ["job id mismatch", 200, { id: "other", orgId: "shiweiya", siteId: "47734", locations: [{ cityName: "北京市" }] }],
    ["org mismatch", 200, { id: "servier-1", orgId: "other", siteId: "47734", locations: [{ cityName: "北京市" }] }],
    ["site mismatch", 200, { id: "servier-1", orgId: "shiweiya", siteId: "70032", locations: [{ cityName: "北京市" }] }],
    ["site missing without profile authorization", 200, { id: "servier-1", orgId: "shiweiya", locations: [{ cityName: "北京市" }] }],
    ["missing location", 200, { id: "servier-1", orgId: "shiweiya", siteId: "47734", locations: [] }],
    ["rate limit", 429, { error: "rate limited" }],
    ["temporary http failure", 503, { error: "unavailable" }],
    ["non-retryable http failure", 404, { error: "not found" }]
  ])("fails closed and retains detail evidence on %s", async (_label, status, detail) => {
    const http: MokaHttpClient = async (request) => {
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "servier-1", title: "医学信息沟通专员" }] }
        })), "api");
      }
      return {
        status,
        body: JSON.stringify(detail),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(servierPlan);

    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: expect.arrayContaining([expect.objectContaining({ logicalKey: "moka-detail-0000-0000" })]),
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 1 }
      }
    });
    if (status === 429 || status >= 500) {
      expect(result).toMatchObject({
        failureReason: status === 429
          ? "Official recruitment endpoint temporarily rate limited the request (HTTP 429)"
          : `Official recruitment endpoint was temporarily unavailable (HTTP ${status})`,
        transportFailure: { code: `OFFICIAL_HTTP_${status}`, retryable: true }
      });
    } else {
      expect(result).not.toHaveProperty("transportFailure");
    }
  });

  it.each([
    [
      "sensitive value",
      { id: "servier-1", orgId: "shiweiya", siteId: "47734", locations: [{ cityName: "secret=leak" }] },
      ["secret=leak"]
    ],
    [
      "sensitive key with ordinary value",
      {
        id: "servier-1",
        orgId: "shiweiya",
        siteId: "47734",
        token: "ordinary-value",
        locations: [{ cityName: "北京市" }]
      },
      ["token", "ordinary-value"]
    ]
  ])("redacts raw detail evidence before rejecting a %s", async (_label, detail, forbiddenPlaintext) => {
    const http: MokaHttpClient = async (request) => {
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "servier-1", title: "医学信息沟通专员" }] }
        })), "api");
      }
      return {
        status: 200,
        body: JSON.stringify(detail),
        finalUrl: "https://app.mokahr.com/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(servierPlan);

    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: expect.arrayContaining([expect.objectContaining({
          logicalKey: "moka-detail-0000-0000",
          bodyRepresentation: "REDACTED",
          rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          redactionDescriptors: [{ kind: "CREDENTIAL_MATERIAL", count: 1 }]
        })])
      }
    });
    const serializedEvidence = JSON.stringify(result.fetchEvidence);
    for (const plaintext of forbiddenPlaintext) {
      expect(serializedEvidence).not.toContain(plaintext);
    }
  });

  it("retains a redacted auditable detail failure chain for an evil detail final URL", async () => {
    const evilBody = "evil-detail-body";
    const http: MokaHttpClient = async (request) => {
      if (request.method === "GET") {
        return {
          ...evidenceResponse(htmlWithInitData({
            aesIv, mode: "social", siteId: "47734", org: { id: "shiweiya", siteId: 47734 }
          }), "entry"),
          finalUrl: servierCampaignUrl
        };
      }
      if (request.url.endsWith("/jobs/v2")) {
        return evidenceResponse(JSON.stringify(encryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "servier-1", title: "医学信息沟通专员" }] }
        })), "api");
      }
      return {
        status: 200,
        body: evilBody,
        finalUrl: "https://evil.example/api/outer/ats-apply/website/job",
        contentType: "application/json",
        capturedAt
      };
    };

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(servierPlan);

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("invalid final URL"),
      fetchEvidence: {
        artifacts: [
          expect.objectContaining({ logicalKey: "moka-entry-0000" }),
          expect.objectContaining({ logicalKey: "moka-page-0000" }),
          expect.objectContaining({
            logicalKey: "moka-detail-0000-0000",
            finalUrl: "https://evil.example/api/outer/ats-apply/website/job",
            bodyRepresentation: "REDACTED",
            rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/)
          })
        ],
        fetchLosses: [expect.objectContaining({
          stage: "VALIDATION",
          details: { code: "DETAIL_HYDRATION_FAILED", field: "finalUrl", pageSequence: 0, recordIndex: 0 }
        })]
      }
    });
    expect(JSON.stringify(result.fetchEvidence)).not.toContain(evilBody);
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
