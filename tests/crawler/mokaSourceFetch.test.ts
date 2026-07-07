import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMokaSourceFetch,
  decryptMokaResponse,
  extractMokaInitData,
  type MokaEncryptedResponse,
  type MokaHttpClient
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

describe("Moka source fetch", () => {
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
        return {
          status: 200,
          body: htmlWithInitData({
            aesIv,
            mode: "social",
            siteId: "98934",
            org: { id: "beigene", siteId: 98934, name: "百济神州" }
          })
        };
      }

      return {
        status: 200,
        body: JSON.stringify(
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
        )
      };
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
      limit: 200,
      offset: 0,
      isCampusJob: false
    });
    expect(result.payload).toMatchObject({
      success: true,
      data: {
        jobs: [
          {
            id: "job-1",
            title: "Research Chief",
            officialUrl:
              "https://app.mokahr.com/apply/beigene/98934?sourceToken=token#/job/job-1",
            locationRaw: "上海市",
            cities: ["上海市"]
          }
        ]
      }
    });
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
