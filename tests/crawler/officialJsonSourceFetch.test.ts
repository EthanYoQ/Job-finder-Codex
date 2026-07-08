import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const basePlan = {
  adapterId: "official-json",
  company: { id: "company-innovent", officialChineseName: "信达生物制药（苏州）有限公司" },
  source: {
    id: "source-innovent-social",
    companyId: "company-innovent",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://www.innoventbio.com/cn/recruit",
    officialChainEvidenceUrl: "https://www.innoventbio.com/cn/recruit"
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
  }
} satisfies SourceCrawlPlan;

describe("createOfficialJsonSourceFetch", () => {
  it("normalizes Innovent official API jobs", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        body: JSON.stringify({
          success: true,
          data: [{ id: 74, title: "生物统计高级经理/副总监（上海）", city: "上海" }]
        })
      })
    });

    await expect(
      fetcher({
        ...basePlan,
        officialJsonFetch: {
          kind: "innovent",
          endpointUrl: "https://www.innoventbio.com/api/jobs?limit=200"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: "74",
            title: "生物统计高级经理/副总监（上海）",
            officialUrl: "https://www.innoventbio.com/cn/recruit/74",
            locationRaw: "上海",
            cities: ["上海"]
          }
        ]
      }
    });
  });

  it("normalizes Novo Nordisk official API jobs", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        body: JSON.stringify({
          data: {
            jobs: [
              {
                jobId: "343573.en_GB",
                jobTitle: "Sr New Product Planning Manager",
                jobLocationLabel: "China Mainland, Beijing",
                jobCity: { label: "Beijing", value: "Beijing" }
              }
            ]
          }
        })
      })
    });

    await expect(
      fetcher({
        ...basePlan,
        officialJsonFetch: {
          kind: "novo-nordisk",
          endpointUrl:
            "https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&country=China%20Mainland&category=&locale=en"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: "343573.en_GB",
            title: "Sr New Product Planning Manager",
            officialUrl:
              "https://www.novonordisk.com/careers/find-a-job/job-ad.343573.en_GB.html",
            locationRaw: "China Mainland, Beijing",
            cities: ["北京"]
          }
        ]
      }
    });
  });

  it("extracts China jobs from Phenom embedded eagerLoadRefineSearch JSON", async () => {
    const html = `<script>window.phApp={"ddo":{"eagerLoadRefineSearch":{"status":200,"data":{"jobs":[{"title":"Global Role","jobSeqNo":"GLOBAL1","location":"Boston, United States","country":"United States"},{"title":"Application Scientist","jobSeqNo":"CN1","location":"Shanghai, Shanghai, China","city":"Shanghai","country":"China","applyUrl":""}]}},"flashParams":{}}}</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 200, body: html })
    });

    await expect(
      fetcher({
        ...basePlan,
        source: {
          ...basePlan.source,
          officialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China"
        },
        officialJsonFetch: {
          kind: "phenom",
          detailBaseUrl: "https://careers.emdgroup.com/us/en/job"
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: "CN1",
            title: "Application Scientist",
            officialUrl: "https://careers.emdgroup.com/us/en/job/CN1",
            locationRaw: "Shanghai, Shanghai, China",
            cities: ["上海"]
          }
        ]
      }
    });
  });
});
