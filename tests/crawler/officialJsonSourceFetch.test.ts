import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  sourcePlanConfigSha256,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { OfficialHttpTimeoutError } from "../../src/crawler/officialHttpRuntimeLimits";

const makeExampleCredential = (purpose: string) => `example-placeholder-${purpose}`;
const beisenUuid = (seed: string) =>
  `00000000-0000-4000-8000-${createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 12)}`;

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

const gileadYelloPlan = {
  adapterId: "official-json",
  company: { id: "company-gilead-china", officialChineseName: "吉利德科学" },
  source: {
    id: "source-gilead-china-social",
    companyId: "company-gilead-china",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://gilead.yello.co/job_boards/v42vD4vKxb3AkKvV93YsrQ",
    officialChainEvidenceUrl: "https://www.gilead.com/careers/opportunities"
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
    kind: "yello-job-board",
    boardId: "v42vD4vKxb3AkKvV93YsrQ",
    locationFilterId: 72,
    expectedLocationLabel: "China"
  }
} satisfies SourceCrawlPlan;

describe("createOfficialJsonSourceFetch", () => {
  function hcmCloudResponse(payload: unknown, prefix = "rsp"): string {
    const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
    return JSON.stringify({
      hcm_transfer_strategy: "hb5",
      hcm_param: `${prefix}${base64.replace(/[5a]/gu, (value) => value === "5" ? "a" : "!")}`
    });
  }

  function decodeHcmCloudRequest(body: string | undefined): Record<string, unknown> {
    const parsed = JSON.parse(body ?? "{}") as { hcm_param?: string };
    if (!parsed.hcm_param) {
      throw new Error("Expected HCMCloud request hcm_param");
    }

    return JSON.parse(
      Buffer.from(parsed.hcm_param.slice(3), "base64").toString("utf8")
    ) as Record<string, unknown>;
  }

  function yelloResponse(overrides: Record<string, unknown> = {}) {
    return {
      status: 200,
      finalUrl: "https://gilead.yello.co/job_boards/v42vD4vKxb3AkKvV93YsrQ/search?query=&filters=72",
      contentType: "application/json",
      capturedAt: "2026-08-14T00:00:00.000Z",
      body: JSON.stringify({
        html: [
          '<li class="search-results__item"><div class="search-results__flag"><img alt="China flag" src="/assets/images/flags/cn.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/uGT3Gvh8qEc0h0ftemuOQA?job_board_id=v42vD4vKxb3AkKvV93YsrQ">Senior Therapeutic Specialist I</a><div><span>China - Shenzhen</span><span>Sales</span><span>Regular</span></div></div></li>',
          '<li class="search-results__item"><div class="search-results__flag"><img alt="China flag" src="/assets/images/flags/cn.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/5gfgBTplkJVAZ6Pc83idrA?job_board_id=v42vD4vKxb3AkKvV93YsrQ">Senior Therapeutic Specialist II</a><div><span>China - Changsha</span><span>Sales</span><span>Regular</span></div></div></li>',
          '<li class="search-results__item"><div class="search-results__flag"><img alt="China flag" src="/assets/images/flags/cn.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/Le1jJiFA05bQ2HLko2G3Ow?job_board_id=v42vD4vKxb3AkKvV93YsrQ">Therapeutic Specialist II</a><div><span>China - Wenzhou</span><span>Sales</span><span>Regular</span></div></div></li>'
        ].join(""),
        count_on_page: 3,
        more_requisitions: false,
        query: "",
        filters: JSON.stringify([{ label: "Locations", id: 32, has_conditions: false,
          answers: [{ id: 72, label: "China" }], answer_type: "multiple_select" }]),
        text_filters: "[]",
        display_count_text: "3 Results",
        ...overrides
      })
    };
  }

  function yelloLocationOverrides(locationRaw: string): Record<string, unknown> {
    return {
      html: `<li class="search-results__item"><div class="search-results__flag"><img alt="China flag" src="/assets/images/flags/cn.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/uGT3Gvh8qEc0h0ftemuOQA?job_board_id=v42vD4vKxb3AkKvV93YsrQ">Role</a><div><span>${locationRaw}</span></div></div></li>`,
      count_on_page: 1,
      display_count_text: "1 Result"
    };
  }

  it("reconciles the exact Gilead Yello China filter as a complete official total", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        return yelloResponse();
      }
    });

    const result = await fetcher(gileadYelloPlan);
    expect(requests).toEqual([expect.objectContaining({
      url: "https://gilead.yello.co/job_boards/v42vD4vKxb3AkKvV93YsrQ/search?query=&filters=72",
      headers: expect.objectContaining({ "X-Requested-With": "XMLHttpRequest" })
    })]);
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [
        { title: "Senior Therapeutic Specialist I", locationRaw: "China - Shenzhen",
          officialUrl: "https://gilead.yello.co/jobs/uGT3Gvh8qEc0h0ftemuOQA?job_board_id=v42vD4vKxb3AkKvV93YsrQ" },
        { title: "Senior Therapeutic Specialist II", locationRaw: "China - Changsha", cities: ["长沙"],
          officialUrl: "https://gilead.yello.co/jobs/5gfgBTplkJVAZ6Pc83idrA?job_board_id=v42vD4vKxb3AkKvV93YsrQ" },
        { title: "Therapeutic Specialist II", locationRaw: "China - Wenzhou",
          officialUrl: "https://gilead.yello.co/jobs/Le1jJiFA05bQ2HLko2G3Ow?job_board_id=v42vD4vKxb3AkKvV93YsrQ" }
      ] },
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT", expectedJobCount: 3, pagesVisited: 1 },
      fetchEvidence: { declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 3, scope: "SOURCE" },
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0,
          validationDiscardCount: 0 } }
    });
  });

  it("maps the archived Gilead Taiyuan location without losing the official job", async () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(({ source }) =>
      source.id === "source-gilead-china-social")!;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      http: async () => yelloResponse(yelloLocationOverrides("China - Taiyuan"))
    });
    const fetched = await fetcher(plan);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });

    expect(crawled).toMatchObject({
      status: "SUCCESS",
      jobs: [{ locationRaw: "China - Taiyuan", cities: ["太原"] }],
      observation: {
        structuredJobCount: 1,
        expectedJobCount: 1,
        completenessStatus: "VERIFIED"
      }
    });
  });

  it("replays the archived Gilead Yello response through the staged strict completeness gate", async () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(({ source }) =>
      source.id === "source-gilead-china-social")!;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      http: async () => yelloResponse()
    });
    const fetched = await fetcher(plan);
    const crawled = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { structuredJobCount: 3, expectedJobCount: 3, completenessStatus: "VERIFIED" }
    });
    if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation) {
      throw new Error("Expected exact Gilead Yello crawl evidence");
    }
    const certificate = issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-gilead-yello",
        batchId: "batch-gilead-yello",
        sourceResultId: "result-gilead-yello",
        sourceConfigSha256: sourcePlanConfigSha256(plan)
      },
      plan,
      transportSuccess: crawled.truth.transportSuccess,
      adapterSuccess: crawled.truth.adapterSuccess,
      evidence: crawled.fetchEvidence,
      paginationEvaluation: crawled.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      officialArtifactSha256: "a".repeat(64)
    });
    expect(certificate, JSON.stringify(certificate)).toMatchObject({
      status: "CERTIFIED",
      certificate: {
        grade: "A",
        scope: { companyId: "company-gilead-china", sourceId: "source-gilead-china-social" },
        counts: { officialTotal: 3, finalUniqueJobCount: 3 }
      }
    });
  });

  it.each([
    ["a response that can continue", { more_requisitions: true }],
    ["a mismatched official filter", { filters: JSON.stringify([{ label: "Locations", id: 32,
      has_conditions: false, answers: [{ id: 73, label: "Japan" }], answer_type: "multiple_select" }]) }],
    ["a cross-origin official job link", { html: '<li class="search-results__item"><div class="search-results__flag"><img alt="China flag"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="https://evil.example/jobs/uGT3Gvh8qEc0h0ftemuOQA">Role</a><div><span>China - Shenzhen</span></div></div></li>', count_on_page: 1,
      display_count_text: "1 Result" }],
    ["a Hong Kong location labelled under China", yelloLocationOverrides("China - Hong Kong")],
    ["a Macau location labelled under China", yelloLocationOverrides("China - Macau")],
    ["a Taiwan location labelled under China", yelloLocationOverrides("China - Taiwan")]
  ])("fails closed for %s", async (_label, overrides) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-08-14T00:00:00.000Z"),
      http: async () => yelloResponse(overrides)
    });
    await expect(fetcher(gileadYelloPlan)).resolves.toMatchObject({ ok: false });
  });

  it("normalizes Innovent official API jobs", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        finalUrl: "https://www.innoventbio.com/api/jobs?limit=200",
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({
          success: true,
          data: [{ id: 74, title: "生物统计高级经理/副总监（上海）", city: "上海" }]
        })
      })
    });

    const innoventResult = await fetcher({
        ...basePlan,
        officialJsonFetch: {
          kind: "innovent",
          endpointUrl: "https://www.innoventbio.com/api/jobs?limit=200"
        }
      });
    expect(innoventResult).toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
            title: "生物统计高级经理/副总监（上海）",
            officialUrl: "https://www.innoventbio.com/cn/recruit/74",
            locationRaw: "上海",
            cities: ["上海"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "WEAK_MANUAL_SAMPLE",
        completenessBlockerReason:
          "Innovent single response and configured limit do not prove endpoint exhaustion"
      }
    });
  });

  it("normalizes Novo Nordisk official API jobs", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        finalUrl:
          "https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&country=China%20Mainland&category=&locale=en",
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({
          data: {
            totalMatches: 2,
            jobs: [
              {
                jobId: "343573.en_GB",
                jobTitle: "Sr New Product Planning Manager",
                jobLocationLabel: "China Mainland, Beijing",
                jobCity: { label: "Beijing", value: "Beijing" }
              },
              {
                jobId: "343574.en_GB",
                jobTitle: "Medical Advisor",
                jobLocationLabel: "China Mainland, Chongqing",
                jobCity: { label: "Chongqing", value: "Chongqing" }
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
            sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
            title: "Sr New Product Planning Manager",
            officialUrl:
              "https://www.novonordisk.com/careers/find-a-job/job-ad.343573.en_GB.html",
            locationRaw: "China Mainland, Beijing",
            cities: ["北京"]
          },
          {
            sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
            title: "Medical Advisor",
            officialUrl:
              "https://www.novonordisk.com/careers/find-a-job/job-ad.343574.en_GB.html",
            locationRaw: "China Mainland, Chongqing",
            cities: ["重庆"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      }
    });
  });

  it("fetches Phenom widgets pages with an official country filter and totalHits", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        if (request.method !== "POST") {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "text/html",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: `<script>var phApp={"widgetApiEndpoint":"https://careers.emdgroup.com/widgets","country":"us","deviceType":"desktop","locale":"en_us","refNum":"MQAEGZUS","pageName":"search-results","pageId":"page18"};</script>`
          };
        }

        const body = JSON.parse(request.body ?? "{}") as { from: number; size: number };
        const count = body.from === 0 ? 50 : 2;
        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            refineSearch: {
              status: 200,
              hits: count,
              totalHits: 52,
              data: {
                jobs: Array.from({ length: count }, (_, index) => ({
                  title: `Application Scientist ${body.from + index}`,
                  jobSeqNo: `CN${body.from + index}`,
                  location: "Shanghai, Shanghai, China",
                  city: "Shanghai",
                  country: "China",
                  applyUrl: `https://careers.emdgroup.com/us/en/job/CN${body.from + index}`
                }))
              }
            }
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
        countryFilter: "China",
        pageSize: 50,
        maxPages: 5
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 52,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        totalPages: 2,
        pageSize: 50,
        pagesVisited: 2
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected Phenom payload");
    }
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toHaveLength(52);
    expect(payload.jobs[0]).toMatchObject({
      sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
      title: "Application Scientist 0",
      officialUrl: "https://careers.emdgroup.com/us/en/job/CN0",
      locationRaw: "Shanghai, Shanghai, China",
      cities: ["上海"]
    });
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      selected_fields: { country: ["China"] },
      from: 0,
      size: 50,
      refNum: "MQAEGZUS",
      ddoKey: "refineSearch"
    });
    expect(JSON.parse(requests[2]?.body ?? "{}")).toMatchObject({
      selected_fields: { country: ["China"] },
      from: 50,
      size: 50
    });
  });

  it("marks Phenom widgets payload incomplete when page cap stops before totalHits", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        if (request.method !== "POST") {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "text/html",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: `<script>var phApp={"widgetApiEndpoint":"https://careers.emdgroup.com/widgets","country":"us","deviceType":"desktop","locale":"en_us","refNum":"MQAEGZUS","pageName":"search-results","pageId":"page18"};</script>`
          };
        }

        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            refineSearch: {
              status: 200,
              hits: 10,
              totalHits: 52,
              data: {
                jobs: Array.from({ length: 10 }, (_, index) => ({
                  title: `Application Scientist ${index}`,
                  jobSeqNo: `CN${index}`,
                  location: "Shanghai, Shanghai, China",
                  city: "Shanghai",
                  country: "China",
                  applyUrl: `https://careers.emdgroup.com/us/en/job/CN${index}`
                }))
              }
            }
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://careers.emdgroup.com/us/en/search-results?keywords=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
        countryFilter: "China",
        pageSize: 10,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: false,
      paginationEvaluation: {
        safeCompleteness: false,
          derivedAnomalyCodes: ["MAX_PAGES_WITH_NEXT"]
      },
      fetchEvidence: { fetchCounts: { rawCount: 10, validCount: 10 } }
    });
  });

  it("keeps Merck-style Phenom one-job crawls incomplete when official total is 52", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        if (request.method !== "POST") {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "text/html",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: `<script>var phApp={"widgetApiEndpoint":"https://careers.emdgroup.com/widgets","country":"us","deviceType":"desktop","locale":"en_us","refNum":"MQAEGZUS","pageName":"search-results","pageId":"page18"};</script>`
          };
        }

        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            refineSearch: {
              status: 200,
              hits: 1,
              totalHits: 52,
              data: {
                jobs: [
                  {
                    title: "Merck China Role",
                    jobSeqNo: "MERCK-CN-1",
                    location: "Shanghai, Shanghai, China",
                    city: "Shanghai",
                    country: "China",
                    applyUrl: "https://careers.emdgroup.com/us/en/job/MERCK-CN-1"
                  }
                ]
              }
            }
          })
        };
      }
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
          detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
          countryFilter: "China",
          pageSize: 50,
          maxPages: 1
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      paginationEvaluation: {
        safeCompleteness: false,
        derivedAnomalyCodes: ["INTERMEDIATE_SHORT_PAGE", "MAX_PAGES_WITH_NEXT"]
      }
    });
  });

  it("keeps Phenom China jobs when the city is not in the curated city map", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        if (request.method !== "POST") {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "text/html",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: `<script>var phApp={"widgetApiEndpoint":"https://jobs.organon.com/widgets","country":"cn","deviceType":"desktop","locale":"en_global","refNum":"ORG","pageName":"search-results","pageId":"page18"};</script>`
          };
        }

        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            refineSearch: {
              totalHits: 1,
              data: {
                jobs: [
                  {
                    title: "Pharmaceutical Information Specialist",
                    jobSeqNo: "ORG-1",
                    location: "Nanyang, Henan, China",
                    city: "Nanyang",
                    country: "China",
                    applyUrl: "https://jobs.organon.com/cn/zh/job/ORG-1"
                  }
                ]
              }
            }
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://jobs.organon.com/cn/zh/search-results?keywords=China"
      },
      officialJsonFetch: {
        kind: "phenom",
        detailBaseUrl: "https://jobs.organon.com/cn/zh/job",
        countryFilter: "China",
        pageSize: 50,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
            locationRaw: "Nanyang, Henan, China",
            cities: ["Nanyang"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
  });

  it("fetches Beisen Zhiye 2022 pages using official Count and UUID detail URLs", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body ?? "{}") as { PageIndex: number; PageSize: number };
        const jobs = Array.from({ length: body.PageIndex === 0 ? 2 : 1 }, (_, index) => ({
          Id: beisenUuid(`${body.PageIndex}-${index}`),
          JobAdId: 1000 + body.PageIndex * body.PageSize + index,
          JobAdName: `验证主任助理 ${body.PageIndex}-${index}`,
          LocNames: body.PageIndex === 0 ? ["江苏省·连云港市"] : ["上海市"],
          Country: "中国",
          Category: "社会招聘"
        }));

        return {
          status: 200,
          finalUrl: "https://cttq.zhiye.com/api/Jobad/GetJobAdPageList",
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            Code: 200,
            Count: 3,
            PageIndex: body.PageIndex,
            Data: jobs,
            Total: 0
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://cttq.zhiye.com/social/jobs"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 2,
        maxPages: 5,
        detailPath: "social/detail"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://cttq.zhiye.com/social/jobs",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected Beisen payload");
    }
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toEqual([
      {
        sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
        title: "验证主任助理 0-0",
        officialUrl: `https://cttq.zhiye.com/social/detail?jobAdId=${beisenUuid("0-0")}`,
        locationRaw: "江苏省·连云港市",
        cities: ["连云港市"]
      },
      {
        sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
        title: "验证主任助理 0-1",
        officialUrl: `https://cttq.zhiye.com/social/detail?jobAdId=${beisenUuid("0-1")}`,
        locationRaw: "江苏省·连云港市",
        cities: ["连云港市"]
      },
      {
        sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
        title: "验证主任助理 1-0",
        officialUrl: `https://cttq.zhiye.com/social/detail?jobAdId=${beisenUuid("1-0")}`,
        locationRaw: "上海市",
        cities: ["上海市"]
      }
    ]);
    expect(requests.map((request) => JSON.parse(request.body ?? "{}"))).toEqual([
      expect.objectContaining({ PageIndex: 0, PageSize: 2, Category: ["1"] }),
      expect.objectContaining({ PageIndex: 1, PageSize: 2, Category: ["1"] })
    ]);
  });

  it("marks Beisen Zhiye 2022 incomplete when maxPages stops before Count", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        finalUrl: "https://cttq.zhiye.com/api/Jobad/GetJobAdPageList",
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({
          Code: 200,
          Count: 4,
          PageIndex: 0,
          Data: [
            {
              Id: beisenUuid("max-page-0"),
              JobAdName: "质量经理",
              LocNames: ["上海市"],
              Category: "社会招聘",
              CategoryId: "1",
              Kind: "全职"
            },
            {
              Id: beisenUuid("max-page-1"),
              JobAdName: "注册经理",
              LocNames: ["北京市"],
              Category: "社会招聘",
              CategoryId: "1",
              Kind: "全职"
            }
          ]
        })
      })
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://cttq.zhiye.com/social/jobs"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        pageSize: 2,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { pages: [{ termination: "MAX_PAGE_LIMIT", declaredPages: null }] },
      paginationEvaluation: { safeCompleteness: false }
    });
  });

  it("uses an explicit Beisen Zhiye default location when the official API omits location fields", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 200,
        finalUrl: "https://yangzijiang.zhiye.com/api/Jobad/GetJobAdPageList",
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({
          Code: 200,
          Count: 1,
          PageIndex: 0,
          Data: [
            {
              Id: beisenUuid("no-location"),
              JobAdId: 230917983,
              JobAdName: "产品经理（睡眠领域）",
              Category: "社会招聘",
              CategoryId: "1",
              Kind: "全职"
            }
          ]
        })
      })
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://yangzijiang.zhiye.com/social/jobs"
      },
      officialJsonFetch: {
        kind: "beisen-zhiye-2022",
        category: "1",
        pageSize: 100,
        maxPages: 5,
        detailPath: "social/detail",
        defaultLocationRaw: "未披露"
      }
    });

    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected Beisen payload");
    }
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toEqual([]);
    expect(result.completeness).toMatchObject({
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: 1
    });
    expect(result.fetchEvidence?.fetchLosses).toMatchObject([
      { stage: "VALIDATION", details: { code: "DECLARED_LOCATION_FALLBACK", field: "locationRaw" } }
    ]);
  });

  it("fetches CNStaff pages using official total and page metadata", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const page = Number(new URL(request.url).searchParams.get("p") ?? "1");
        const jobs = Array.from({ length: page === 7 ? 1 : 15 }, (_, index) => ({
          job_id: String((page - 1) * 15 + index + 1),
          job_publish_id: `publish-${page}-${index}`,
          job_name_show: `零售代表-${page}-${index}`,
          job_address_name: page === 1 && index === 0 ? "太原" : page === 1 ? "北京" : "上海"
        }));

        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: JSON.stringify({
            total: 91,
            page: { total: 7, now: page },
            list: jobs
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://daiichisankyo.cnstaff.com/recruit"
      },
      officialJsonFetch: {
        kind: "cnstaff",
        pageSize: 15,
        maxPages: 10
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 91,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://daiichisankyo.cnstaff.com/recruit",
        totalPages: 7,
        pageSize: 15,
        pagesVisited: 7
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected CNStaff payload");
    }
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toHaveLength(91);
    expect(payload.jobs[0]).toEqual({
      sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
      title: "零售代表-1-0",
      officialUrl: "https://daiichisankyo.cnstaff.com/recruitment/job/detail/id/1/",
      locationRaw: "太原",
      cities: ["太原"]
    });
    expect(requests.map((request) => new URL(request.url).searchParams.get("p"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7"
    ]);
  });

  it("marks CNStaff incomplete when maxPages stops before the official total", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => ({
        status: 200,
        finalUrl: request.url,
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({
          total: 30,
          page: { total: 2, now: 1 },
          list: [
            {
              job_id: "12795",
              job_name_show: "零售代表-太原",
              job_address_name: "北京"
            }
          ]
        })
      })
    });

    await expect(
      fetcher({
        ...basePlan,
        source: {
          ...basePlan.source,
          officialEntryUrl: "https://daiichisankyo.cnstaff.com/recruit"
        },
        officialJsonFetch: {
          kind: "cnstaff",
          pageSize: 15,
          maxPages: 1
        }
      })
    ).resolves.toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 30,
        completenessBlockerReason: expect.stringContaining("manual review"),
        totalPages: 2,
        pageSize: 15,
        pagesVisited: 1
      }
    });
  });

  it("fetches HCMCloud model list using official count and pagination", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        if (request.url.includes("hcm.model.count")) {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "application/json",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: hcmCloudResponse({
              result: {
                list: [{ count__id: 33 }]
              }
            })
          };
        }

        const payload = decodeHcmCloudRequest(request.body);
        const pageIndex = Number(payload.page_index);
        const pageSize = Number(payload.page_size);
        const count = pageIndex === 1 ? 20 : 13;
        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: hcmCloudResponse({
            result: {
              page_index: pageIndex,
              list: Array.from({ length: count }, (_, index) => ({
                id: (pageIndex - 1) * pageSize + index + 1,
                name: `医学专员-${pageIndex}-${index}`,
                work_city: "上海市"
              }))
            }
          })
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://hcm.lunan.com.cn/recruit"
      },
      officialJsonFetch: {
        kind: "hcm-cloud",
        pageSize: 20,
        maxPages: 5,
        defaultLocationRaw: "未披露"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 33,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://hcm.lunan.com.cn/recruit",
        pageSize: 20,
        pagesVisited: 2
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected HCMCloud payload");
    }

    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toHaveLength(33);
    expect(payload.jobs[0]).toEqual({
      sourceJobId: expect.stringMatching(/^official-json:sha256:[0-9a-f]{64}$/),
      title: "医学专员-1-0",
      officialUrl: "https://hcm.lunan.com.cn/recruit/#/portal_job_detail?id=1",
      locationRaw: "上海市",
      cities: ["上海市"]
    });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/hcm.model.count",
      "/api/hcm.model.list",
      "/api/hcm.model.list"
    ]);
    expect(requests.map((request) => request.method)).toEqual(["POST", "POST", "POST"]);
    expect(decodeHcmCloudRequest(requests[0]?.body)).toMatchObject({
      model: "ReleaseJobMgr",
      count_by: ["id"],
      page_index: null,
      page_size: null
    });
    expect(decodeHcmCloudRequest(requests[1]?.body)).toMatchObject({
      model: "ReleaseJobMgr",
      filter_dict: { job_class: "社会招聘", status: "1", delivery: 1 },
      page_index: 1,
      page_size: 20
    });
    expect(decodeHcmCloudRequest(requests[2]?.body)).toMatchObject({
      page_index: 2,
      page_size: 20
    });
  });

  it("accepts the audited Lunan three-character alphanumeric response nonce without weakening hb5 decoding", async () => {
    for (const prefix of ["JHf", "KPm", "NOY", "lsu"]) {
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date("2026-07-08T00:00:00.000Z"),
        http: async (request) => ({
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: request.url.includes("hcm.model.count")
            ? hcmCloudResponse({ result: { count: 1, list: [{ count__id: 1, id: 1 }] } }, prefix)
            : hcmCloudResponse({ result: {
                count: 1,
                page_index: 1,
                list: [{ id: 1, name: "医学专员", work_city: "上海市" }]
              } }, prefix)
        })
      });

      await expect(fetcher({
        ...basePlan,
        source: { ...basePlan.source, officialEntryUrl: "https://hcm.lunan.com.cn/recruit" },
        officialJsonFetch: {
          kind: "hcm-cloud",
          pageSize: 20,
          maxPages: 1,
          countCoordinatePolicy: "LUNAN_AGGREGATE_ROW",
          responsePrefixPolicy: "LUNAN_RANDOM_ALNUM3",
          defaultLocationRaw: "未披露"
        }
      })).resolves.toMatchObject({
        ok: true,
        fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 } },
        payload: { jobs: [{ title: "医学专员", locationRaw: "上海市" }] }
      });
    }
  });

  it("rejects non-alphanumeric Lunan response prefixes and binds the policy to the exact official entry", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => ({
        status: 200,
        finalUrl: request.url,
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: hcmCloudResponse({ result: { count: 1, list: [{ count__id: 1, id: 1 }] } }, "$12")
      })
    });
    const config = {
      kind: "hcm-cloud" as const,
      pageSize: 20,
      maxPages: 1,
      countCoordinatePolicy: "LUNAN_AGGREGATE_ROW" as const,
      responsePrefixPolicy: "LUNAN_RANDOM_ALNUM3" as const,
      defaultLocationRaw: "未披露"
    };

    await expect(fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://hcm.lunan.com.cn/recruit" },
      officialJsonFetch: config
    })).resolves.toMatchObject({ ok: false, failureReason: "HCMCloud count response decode failed" });
    await expect(fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://hcm.example.test/recruit" },
      officialJsonFetch: config
    })).resolves.toMatchObject({ ok: false, failureReason: "HCMCloud official entry URL is invalid" });
  });

  it("completes audited Lunan pagination when the official response binds pages only through the request", async () => {
    const jobs = Array.from({ length: 33 }, (_, index) => ({
      id: index + 1,
      name: `职位 ${index + 1}`,
      work_city: "临沂市"
    }));
    let listPage = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        if (request.url.includes("hcm.model.count")) {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "application/json",
            capturedAt: "2026-07-13T00:00:00.000Z",
            body: hcmCloudResponse({
              srv_begin: 1,
              result: { list: [{ count__id: 33, id: 33 }], count: 1 },
              srv_end: 2,
              srv_all: 3
            }, "JHf")
          };
        }
        listPage += 1;
        const list = listPage === 1 ? jobs.slice(0, 20) : jobs.slice(20);
        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-13T00:00:00.000Z",
          body: hcmCloudResponse({
            srv_begin: listPage * 10,
            result: { list, count: 0 },
            srv_end: listPage * 10 + 1,
            srv_all: listPage * 10 + 2
          }, listPage === 1 ? "KPm" : "NOY")
        };
      }
    });

    await expect(fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://hcm.lunan.com.cn/recruit" },
      officialJsonFetch: {
        kind: "hcm-cloud",
        pageSize: 20,
        maxPages: 2,
        countCoordinatePolicy: "LUNAN_AGGREGATE_ROW",
        responsePrefixPolicy: "LUNAN_RANDOM_ALNUM3",
        listPaginationPolicy: "LUNAN_REQUEST_BOUND_PAGE_V1",
        defaultLocationRaw: "未披露"
      }
    })).resolves.toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 33, validCount: 33 },
        artifacts: expect.arrayContaining([
          expect.objectContaining({
            logicalKey: "hcm-list-0001",
            extractorLocator: expect.stringContaining("|returned-page:request-bound:lunan-v1")
          })
        ]),
        pages: [
          { requestedPage: 1, returnedPage: 1, termination: "CONTINUE" },
          { requestedPage: 2, returnedPage: 2, termination: "DECLARED_TOTAL_REACHED" }
        ]
      },
      payload: {
        jobs: expect.arrayContaining([
          expect.objectContaining({ title: "职位 33", locationRaw: "临沂市" })
        ])
      }
    });
  });

  it("rejects a changed Lunan request-bound list envelope", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => ({
        status: 200,
        finalUrl: request.url,
        contentType: "application/json",
        capturedAt: "2026-07-13T00:00:00.000Z",
        body: request.url.includes("hcm.model.count")
          ? hcmCloudResponse({
              srv_begin: 1,
              result: { list: [{ count__id: 1, id: 1 }], count: 1 },
              srv_end: 2,
              srv_all: 3
            }, "JHf")
          : hcmCloudResponse({
              srv_begin: 4,
              result: { list: [{ id: 1, name: "医学专员", work_city: "临沂市" }], count: 1 },
              srv_end: 5,
              srv_all: 6
            }, "KPm")
      })
    });

    await expect(fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://hcm.lunan.com.cn/recruit" },
      officialJsonFetch: {
        kind: "hcm-cloud",
        pageSize: 20,
        maxPages: 1,
        countCoordinatePolicy: "LUNAN_AGGREGATE_ROW",
        responsePrefixPolicy: "LUNAN_RANDOM_ALNUM3",
        listPaginationPolicy: "LUNAN_REQUEST_BOUND_PAGE_V1",
        defaultLocationRaw: "未披露"
      }
    })).resolves.toMatchObject({ ok: false, failureReason: "HCMCloud list shape is invalid" });
  });

  it("marks HCMCloud incomplete when maxPages stops before the official total", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        if (request.url.includes("hcm.model.count")) {
          return {
            status: 200,
            finalUrl: request.url,
            contentType: "application/json",
            capturedAt: "2026-07-08T00:00:00.000Z",
            body: hcmCloudResponse({
              result: {
                list: [{ count__id: 33 }]
              }
            })
          };
        }

        return {
          status: 200,
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z",
          body: hcmCloudResponse({
            result: {
              page_index: 1,
              list: Array.from({ length: 20 }, (_, index) => ({
                id: index + 1,
                name: `医学专员-${index}`,
                work_city: "上海市"
              }))
            }
          })
        };
      }
    });

    const maxResult = await fetcher({
        ...basePlan,
        source: {
          ...basePlan.source,
          officialEntryUrl: "https://hcm.lunan.com.cn/recruit"
        },
        officialJsonFetch: {
          kind: "hcm-cloud",
          pageSize: 20,
          maxPages: 1,
          defaultLocationRaw: "未披露"
        }
      });
    expect(maxResult).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 33,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessBlockerReason: expect.stringContaining("downstream adapter accounting"),
        pageSize: 20,
        pagesVisited: 1
      }
    });
  });

  it("falls back to a browser-backed HCMCloud client when direct API requests are blocked", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({
        status: 500,
        finalUrl: "https://hcm.lunan.com.cn/api/hcm.model.count?model=ReleaseJobMgr",
        contentType: "application/json",
        capturedAt: "2026-07-08T00:00:00.000Z",
        body: JSON.stringify({ errcode: 17003 })
      }),
      hcmCloudBrowserFetch: (async ({ entryUrl }: { entryUrl: string }) => ({
        ok: true,
        capturedAt: "2026-07-08T00:00:00.000Z",
        payload: {
          jobs: [
            {
              sourceJobId: "browser-1",
              title: "医学专员",
              officialUrl: `${entryUrl}/#/portal_job_detail?id=browser-1`,
              locationRaw: "未披露",
              cities: ["未披露"]
            }
          ]
        },
        completeness: {
          completenessStatus: "VERIFIED",
          expectedJobCount: 1,
          completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
          completenessEvidenceUrl: entryUrl,
          pagesVisited: 1,
          completenessBlockerReason: "unsafe injected certification"
        }
      })) as never
    });

    await expect(
      fetcher({
        ...basePlan,
        source: {
          ...basePlan.source,
          officialEntryUrl: "https://hcm.lunan.com.cn/recruit"
        },
        officialJsonFetch: {
          kind: "hcm-cloud",
          pageSize: 20,
          maxPages: 5
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: "HCMCloud browser session failed",
      priorTransportAttempts: [{
        code: "HCM_DIRECT_FAILED",
        fetchEvidence: { artifacts: [{ kind: "ATS_API_RESPONSE" }] }
      }, {
        transport: "BROWSER_SESSION",
        outcome: "FAILED",
        code: "HCM_BROWSER_SESSION_FAILED"
      }]
    });
  });

  it("fetches the official Sandoz China partition after taxonomy validation and exact alternate-zero probes", async () => {
    const requests: Array<{ url: string; method?: string; headers?: Record<string, string> }> = [];
    const endpoint = "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search";
    const taxonomyEndpoint = "https://sandoz-com.cms.sandoz.com/jsonapi/taxonomy_term/job_location";
    const taxonomyUrl = `${taxonomyEndpoint}?filter%5Bdrupal_internal__tid%5D=806`;
    const countryUuid = "2f829192-01a9-4909-b729-baab0b0bad0c";
    const fields = "title,field_job_title,field_job_employment_type,field_job_type,field_job_id,field_job_business_unit,field_job_work_location,field_job_posted_date,path,drupal_internal__tid,field_date,field_job_country,field_job_alt_country_1,field_job_alt_country_2,field_job_alt_country_3";
    const listUrl = (probe: "primary" | "alt1" | "alt2" | "alt3") => {
      const url = new URL(endpoint);
      url.searchParams.set("fields[node--jobs]", fields);
      url.searchParams.set("page", "0");
      url.searchParams.set("views-filter[field_job_functional_area]", "All");
      url.searchParams.set("views-filter[field_job_posted_date][min]", "");
      url.searchParams.set("views-filter[field_job_posted_date][max]", "");
      if (probe === "primary") {
        url.searchParams.set("views-filter[field_job_country]", "806");
        url.searchParams.set("views-filter[field_job_alt_country_1]", "");
      } else if (probe === "alt1") {
        url.searchParams.set("views-filter[field_job_country]", "All");
        url.searchParams.set("views-filter[field_job_alt_country_1]", "806");
      } else if (probe === "alt2") {
        url.searchParams.set("views-filter[field_job_country]", "All");
        url.searchParams.set("views-filter[field_job_alt_country_1]", "");
        url.searchParams.set("views-filter[field_job_alt_country_2]", "806");
      } else {
        url.searchParams.set("views-filter[field_job_country]", "All");
        url.searchParams.set("views-filter[field_job_alt_country_1]", "");
        url.searchParams.set("views-filter[field_job_alt_country_3]", "806");
      }
      return url.toString();
    };
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        if (request.url === "https://www.sandoz.com/careers/job-search/") {
          return {
            status: 200,
            body: `<script id="__NEXT_DATA__" type="application/json">{"props":{"appData":{"token":"${makeExampleCredential("sandoz")}"}}}</script>`,
            finalUrl: request.url,
            contentType: "text/html",
            capturedAt: "2026-07-08T00:00:00.000Z"
          };
        }
        if (request.url === taxonomyUrl) {
          return {
            status: 200,
            body: JSON.stringify({ data: [{
              type: "taxonomy_term--job_location",
              id: countryUuid,
              attributes: { drupal_internal__tid: 806, name: "LOC_CN" }
            }] }),
            finalUrl: request.url,
            contentType: "application/vnd.api+json",
            capturedAt: "2026-07-08T00:00:00.000Z"
          };
        }
        const jobs = request.url === listUrl("primary") ? [
          {
            type: "node--jobs",
            id: "4816e692-7bed-4a07-80a9-cd6dd2823fa7",
            attributes: {
              field_job_id: "REQ-10029354",
              field_job_title: "AS&T (Analytical Science & Technology) Manager",
              field_job_work_location: "Shanghai (Shanghai) (Sandoz)",
              path: { alias: "/ast-analytical-science-technology-manager" }
            },
            relationships: { field_job_country: { data: [{
              type: "taxonomy_term--job_location",
              id: countryUuid,
              meta: { drupal_internal__target_id: 806, term_name: "LOC_CN" }
            }] } }
          },
          {
            type: "node--jobs",
            id: "857d95c7-7847-4904-bb50-648068a190b1",
            attributes: {
              field_job_id: "REQ-10029352",
              field_job_title: "Senior Quality Assurance Manager",
              field_job_work_location: "Shanghai (Shanghai) (Sandoz)",
              path: { alias: "/senior-quality-assurance-manager" }
            },
            relationships: { field_job_country: { data: [{
              type: "taxonomy_term--job_location",
              id: countryUuid,
              meta: { drupal_internal__target_id: 806, term_name: "LOC_CN" }
            }] } }
          }
        ] : [];
        return {
          status: 200,
          body: JSON.stringify({ data: jobs, meta: { count: jobs.length },
            links: { self: { href: request.url } }, number_of_items_per_page: 10 }),
          finalUrl: request.url,
          contentType: "application/vnd.api+json",
          capturedAt: "2026-07-08T00:00:00.000Z"
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://www.sandoz.com/careers/job-search/" },
      officialJsonFetch: {
        kind: "sandoz-jsonapi",
        endpointUrl: endpoint,
        taxonomyEndpointUrl: taxonomyEndpoint,
        countryTermName: "LOC_CN",
        countryTermTargetId: 806,
        countryTermUuid: countryUuid,
        pageSize: 10,
        maxPages: 5,
        detailBaseUrl: "https://www.sandoz.com"
      }
    });

    expect(result).toMatchObject({ ok: true, completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: 2,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: "https://www.sandoz.com/careers/job-search/",
      totalPages: 1,
      pageSize: 10,
      pagesVisited: 1
    }, paginationEvaluation: { safeCompleteness: true, verifiedEligible: true } });
    if (!result.ok || !("payload" in result)) throw new Error("Expected Sandoz payload");
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toEqual([
      { sourceJobId: "REQ-10029354", title: "AS&T (Analytical Science & Technology) Manager",
        officialUrl: "https://www.sandoz.com/ast-analytical-science-technology-manager/",
        locationRaw: "Shanghai (Shanghai) (Sandoz)", cities: ["上海"] },
      { sourceJobId: "REQ-10029352", title: "Senior Quality Assurance Manager",
        officialUrl: "https://www.sandoz.com/senior-quality-assurance-manager/",
        locationRaw: "Shanghai (Shanghai) (Sandoz)", cities: ["上海"] }
    ]);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://www.sandoz.com/careers/job-search/", taxonomyUrl,
      listUrl("primary"), listUrl("alt1"), listUrl("alt2"), listUrl("alt3")
    ]);
    expect(requests[2]?.url).toContain("field_job_country%5D=806");
    expect(requests[2]?.url).not.toContain("field_job_country%5D=All");
    expect(requests.slice(1).every((request) => request.headers?.Authorization === `Bearer ${makeExampleCredential("sandoz")}`)).toBe(true);
  });

  it("fetches Xiuzheng official job-list pages with page parameter traversal", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
        requestBodies.push(body);
        const page = Number(body.page ?? 1);

        return {
          status: 200,
          body: JSON.stringify({
            code: 0,
            data: {
              current_page: page,
              last_page: 2,
              per_page: 2,
              total: 3,
              data:
                page === 1
                  ? [
                      { id: 17, name: "用人理念", operate_time: "2023-12-12" },
                      { id: 16, name: "福建永春制药有限公司招聘", operate_time: "2022-12-29" }
                    ]
                  : [{ id: 5, name: "化药制剂研究员", operate_time: "2022-11-24" }]
            }
          }),
          finalUrl: request.url,
          contentType: "application/json",
          capturedAt: "2026-07-08T00:00:00.000Z"
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        id: "source-xiuzheng-social",
        companyId: "company-xiuzheng",
        officialEntryUrl: "https://www.xiuzheng.com/#/recruit",
        officialChainEvidenceUrl: "https://www.xiuzheng.com/"
      },
      officialJsonFetch: {
        kind: "xiuzheng-job-list",
        endpointUrl: "https://www.xiuzheng.com/front/human-resource/job-list",
        detailBaseUrl: "https://www.xiuzheng.com/#/recruitDetail",
        defaultLocationRaw: "未披露",
        pageSize: 2,
        maxPages: 5
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobs: [
          {
            sourceJobId: "16",
            title: "福建永春制药有限公司招聘",
            officialUrl: "https://www.xiuzheng.com/#/recruitDetail?id=16&type=job&scene=2",
            locationRaw: "未披露",
            cities: ["未披露"]
          },
          {
            sourceJobId: "5",
            title: "化药制剂研究员",
            officialUrl: "https://www.xiuzheng.com/#/recruitDetail?id=5&type=job&scene=2",
            locationRaw: "未披露",
            cities: ["未披露"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://www.xiuzheng.com/#/recruit",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      }
    });
    expect(requestBodies).toEqual([
      { page: 1, pageSize: 2 },
      { page: 2, pageSize: 2 }
    ]);
    expect(result.fetchEvidence?.fetchCounts).toEqual({
      rawCount: 3,
      parsedCount: 3,
      validCount: 2,
      parseDiscardCount: 0,
      validationDiscardCount: 1
    });
    expect(result.fetchEvidence?.fetchLosses).toMatchObject([
      { details: { code: "NON_RECRUITMENT_CONTENT" } }
    ]);
  });

  it("fetches Jobsyn Solr pages using official pagination total", async () => {
    const requests: Array<{ url: string; method?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const url = new URL(request.url);
        const page = Number(url.searchParams.get("page") ?? "1");
        const jobs = Array.from({ length: page === 1 ? 9 : 4 }, (_, index) => ({
          guid: `guid-${page}-${index}`,
          title_exact: `Field Service Engineer ${page}-${index}`,
          title_slug: `field-service-engineer-${page}-${index}`,
          location_exact: index === 0 ? "Shanghai, CHN" : "Virtual, CHN",
          city_exact: index === 0 ? "Shanghai" : undefined,
          country_exact: "China"
        }));

        return {
          status: 200,
          body: JSON.stringify({
            jobs,
            pagination: {
              page,
              page_size: 9,
              total: 13,
              total_pages: 2,
              has_more_pages: page === 1
            }
          }),
          finalUrl: request.url,
          contentType: "application/json; charset=utf-8",
          capturedAt: "2026-07-08T00:00:00.000Z"
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl: "https://grifols.jobs/locations/chn/jobs/"
      },
      officialJsonFetch: {
        kind: "jobsyn-solr",
        endpointUrl: "https://prod-search-api.jobsyn.org/api/v1/solr/search",
        siteOrigin: "grifols.jobs",
        location: "chn",
        pageSize: 9,
        maxPages: 5,
        detailBaseUrl: "https://grifols.jobs"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 13,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://grifols.jobs/locations/chn/jobs/",
        totalPages: 2,
        pageSize: 9,
        pagesVisited: 2
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected Jobsyn payload");
    }

    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toHaveLength(13);
    expect(payload.jobs[0]).toEqual({
      sourceJobId: "guid-1-0",
      title: "Field Service Engineer 1-0",
      officialUrl: "https://grifols.jobs/shanghai-chn/field-service-engineer-1-0/guid-1-0/job/",
      locationRaw: "Shanghai, CHN",
      cities: ["上海"]
    });
    expect(requests.map((request) => new URL(request.url).searchParams.get("page"))).toEqual([
      "1",
      "2"
    ]);
    expect(requests[0]?.url).toContain("location=chn");
    expect(requests[0]?.url).toContain("num_items=9");
  });

  it.each([
    ["timeout", async () => { throw new OfficialHttpTimeoutError(); }, "OFFICIAL_HTTP_TIMEOUT"],
    ["HTTP 503", async (request: { url: string }) => ({
      status: 503,
      body: "{}",
      finalUrl: request.url,
      contentType: "application/json",
      capturedAt: "2026-07-08T00:00:00.000Z"
    }), "OFFICIAL_HTTP_503"]
  ] as const)("classifies a transient Jobsyn %s response for the bounded source retry", async (_case, http, code) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http
    });

    const result = await fetcher({
      ...basePlan,
      source: { ...basePlan.source, officialEntryUrl: "https://grifols.jobs/locations/chn/jobs/" },
      officialJsonFetch: {
        kind: "jobsyn-solr",
        endpointUrl: "https://prod-search-api.jobsyn.org/api/v1/solr/search",
        siteOrigin: "grifols.jobs",
        location: "chn",
        pageSize: 9,
        maxPages: 5,
        detailBaseUrl: "https://grifols.jobs"
      }
    });

    expect(result).toMatchObject({
      ok: false,
      transportFailure: { code, retryable: true }
    });
  });

  it("fetches Redsea channel lists after the official entry page establishes a session", async () => {
    const requests: Array<{ url: string; method?: string; body?: string; cookie?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date("2026-07-09T00:00:00.000Z"),
      http: async (request) => {
        requests.push({
          url: request.url,
          ...(request.method === undefined ? {} : { method: request.method }),
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(request.headers.Cookie === undefined ? {} : { cookie: request.headers.Cookie })
        });
        if (request.url.endsWith("/ch-social/officeWebsite.mob")) {
          return {
            status: 200,
            setCookie: ["routeEhr02=route-social; Path=/", "JSESSIONID=session-social; Path=/"],
            body: "<title>招聘官网</title>", finalUrl: request.url, contentType: "text/html", capturedAt: "2026-07-09T00:00:00.000Z"
          };
        }
        if (request.url.endsWith("/ch-campus/officeWebsite.mob")) {
          return {
            status: 200,
            setCookie: ["routeEhr02=route-campus; Path=/", "JSESSIONID=session-campus; Path=/"],
            body: "<title>招聘官网</title>", finalUrl: request.url, contentType: "text/html", capturedAt: "2026-07-09T00:00:00.000Z"
          };
        }
        if (request.url.includes("officePage.mob")) {
          return {
            status: 200,
            body: "<title>招聘列表</title>", finalUrl: request.url, contentType: "text/html", capturedAt: "2026-07-09T00:00:00.000Z"
          };
        }

        const body = new URLSearchParams(request.body ?? "");
        const channelQrId = body.get("channelQrId");
        const jobs =
          channelQrId === "ch-social"
            ? [
                {
                  REQUEST_ID: "social-1",
                  PUBLISH_NAME: "区域推广经理",
                  work_place: "北京市"
                },
                {
                  REQUEST_ID: "social-2",
                  PUBLISH_NAME: "学术代表",
                  work_place: "上海市"
                }
              ]
            : [
                {
                  REQUEST_ID: "campus-1",
                  PUBLISH_NAME: "医学专员",
                  work_place: "河北省石家庄市"
                }
              ];
        return {
          status: 200,
          body: JSON.stringify({
            state: "1",
            meg: "处理成功",
            total: "",
            jsonList: jobs
          }), finalUrl: request.url, contentType: "application/json", capturedAt: "2026-07-09T00:00:00.000Z"
        };
      }
    });

    const result = await fetcher({
      ...basePlan,
      source: {
        ...basePlan.source,
        officialEntryUrl:
          "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/ch-social/officeWebsite.mob"
      },
      officialJsonFetch: {
        kind: "redsea-zp-channel",
        rootId: "cspc",
        channels: [
          { channelQrId: "ch-social", purpose: "SOCIAL" },
          { channelQrId: "ch-campus", purpose: "CAMPUS" }
        ],
        paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "VERIFIED",
        completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL",
        completenessEvidenceUrl:
          "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/ch-social/officeWebsite.mob",
        pagesVisited: 1
      }
    });
    if (!result.ok || !("payload" in result)) {
      throw new Error("Expected Redsea payload");
    }
    const payload = result.payload as { jobs: unknown[] };
    expect(payload.jobs).toEqual([
      {
        sourceJobId: "ch-social:social-1",
        title: "区域推广经理",
        officialUrl:
          "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/ch-social/officeWebsite.mob?jumpPageId=detail&detailRequestId=social-1&rootId=cspc",
        locationRaw: "北京市",
        cities: ["北京"]
      },
      {
        sourceJobId: "ch-social:social-2",
        title: "学术代表",
        officialUrl:
          "https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/ch-social/officeWebsite.mob?jumpPageId=detail&detailRequestId=social-2&rootId=cspc",
        locationRaw: "上海市",
        cities: ["上海"]
      }
    ]);
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/RedseaPlatform/zhaopin/zpChannelQrCode/ch-social/officeWebsite.mob",
      "/RedseaPlatform/zhaopin/zpChannelQrCode/officePage.mob",
      "/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob"
    ]);
    expect(requests[1]?.cookie).toBe("routeEhr02=route-social; JSESSIONID=session-social");
    expect(requests.some((request) => request.url.includes("ch-campus"))).toBe(false);
  });
});
