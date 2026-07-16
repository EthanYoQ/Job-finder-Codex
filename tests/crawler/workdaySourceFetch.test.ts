import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import type { WorkdayHttpResponse } from "../../src/crawler/workdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { expectedChannelSetHash, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { OfficialHttpTimeoutError } from "../../src/crawler/officialHttpRuntimeLimits";

type OfficialJsonSourceCrawlPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;

const EXPECTED_CHANNELS = [{
  channelId: "source:source-pfizer-china-social:default",
  kind: "SOCIAL" as const
}];

const plan = {
  adapterId: "official-json",
  company: { id: "company-pfizer-china", officialChineseName: "辉瑞" },
  source: {
    id: "source-pfizer-china-social",
    companyId: "company-pfizer-china",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
  },
  expectedChannels: EXPECTED_CHANNELS,
  expectedChannelSetHash: expectedChannelSetHash(EXPECTED_CHANNELS),
  json: {
    jobsPath: "jobPostings",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  workday: {
    tenant: "pfizer",
    site: "PfizerCareers",
    searchText: "China",
    appliedFacets: { Location_Country: ["china-id"] },
    pageSize: 2,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;

function response(
  body: unknown,
  capturedAt = "2026-07-08T00:00:00.000Z",
  overrides: Partial<WorkdayHttpResponse> = {}
): WorkdayHttpResponse {
  return {
    status: 200,
    body: typeof body === "string" ? body : JSON.stringify(body),
    finalUrl: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
    contentType: "application/json; charset=utf-8",
    capturedAt,
    ...overrides
  };
}

function workdayId(externalPath: string): string {
  return `workday:sha256:${createHash("sha256").update(Buffer.from(externalPath, "utf8")).digest("hex")}`;
}

function requestContractLocatorPattern(baseLocator: "$.total" | "$.facets"): RegExp {
  const escaped = baseLocator.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}\\|request-contract-v2\\|sha256:[0-9a-f]{64}$`, "u");
}

const JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES = [
  "CN002 Beijing Jianguo Road",
  "CN008 Chengdu Zong Fu Rd",
  "CN009 Chongqing Zourong Rd",
  "CN016 Harbin",
  "CN019 Jinan Shanda Rd",
  "CN027 Shanghai Gui Qing Rd",
  "CN038 Suzhou Changyang Rd",
  "CN043 Wuhan TaiHe Plaza",
  "CN046 Zhengzhou"
] as const;

const JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES = [
  "Alaska (Any City)",
  "Arizona (Any City)",
  "California (Any City)",
  "Colorado (Any City)",
  "Connecticut (Any City)",
  "Delaware (Any City)",
  "Florida (Any City)",
  "Georgia (Any City)",
  "Idaho (Any City)",
  "Indiana (Any City)",
  "Kentucky (Any City)",
  "Louisiana (Any City)",
  "Maine (Any City)",
  "Maryland (Any City)",
  "Massachusetts (Any City)",
  "Michigan (Any City)",
  "Mississippi (Any City)",
  "Montana (Any City)",
  "Nevada (Any City)",
  "New Hampshire (Any City)",
  "New Jersey (Any City)",
  "New Mexico (Any City)",
  "New York (Any City)",
  "North Carolina (Any City)",
  "North Dakota (Any City)",
  "Ohio (Any City)",
  "Oregon (Any City)",
  "Pennsylvania (Any City)",
  "Rhode Island (Any City)",
  "South Carolina (Any City)",
  "South Dakota (Any City)",
  "Utah (Any City)",
  "Vermont (Any City)",
  "Virginia (Any City)",
  "Washington (Any City)",
  "West Virginia (Any City)",
  "Wisconsin (Any City)",
  "Wyoming (Any City)",
  "Albany, New York, United States of America",
  "Boston, Massachusetts, United States of America",
  "Cambridge, Massachusetts, United States of America",
  "Cincinnati, Ohio, United States of America",
  "Colorado Springs, Colorado, United States of America",
  "Danvers, Massachusetts, United States of America",
  "El Paso, Texas, United States of America",
  "Gurabo, Puerto Rico, United States of America",
  "Horsham, Pennsylvania, United States of America",
  "Houston, Texas, United States of America",
  "Irvine, California, United States of America",
  "Irving, Texas, United States of America",
  "Jacksonville, Florida, United States of America",
  "La Jolla, California, United States of America",
  "Los Angeles, California, United States of America",
  "Malvern, Pennsylvania, United States of America",
  "Miami, Florida, United States of America",
  "Minneapolis, Minnesota, United States of America",
  "New Brighton, Minnesota, United States of America",
  "Orlando, Florida, United States of America",
  "Palm Beach Gardens, Florida, United States of America",
  "Providence, Rhode Island, United States of America",
  "Raritan, New Jersey, United States of America",
  "Raynham, Massachusetts, United States of America",
  "Richmond, Virginia, United States of America",
  "Sacramento, California, United States of America",
  "Salt Lake City, Utah, United States of America",
  "SAN ANTONIO, Texas, United States of America",
  "San Diego, California, United States of America",
  "San Francisco, California, United States of America",
  "San Jose, California, United States of America",
  "Santa Clara, California, United States of America",
  "Seattle, Washington, United States of America",
  "South San Francisco, California, United States of America",
  "Spring House, Pennsylvania, United States of America",
  "Tampa, Florida, United States of America",
  "Titusville, New Jersey, United States of America",
  "Warsaw, Indiana, United States of America",
  "Washington, District of Columbia, United States of America",
  "West Chester, Pennsylvania, United States of America",
  "CZ005 Walterovo Namesti",
  "DK005 Copenhagen",
  "FI001 Espoo",
  "FR015 Rungis",
  "GB019 Bessemer",
  "GB025 ACT London, UK",
  "IE006 Airton",
  "IE009 Janssen Cilag Ltd",
  "IT002 Milano",
  "IT004 Pratica di Mare   Pomezia",
  "NL017 Roden",
  "NO001 Oslo",
  "SE007 Stockholm",
  "Ankara, Turkey",
  "Istanbul, Turkey",
  "Remote (US)",
  "Seoul, Korea, Republic of",
  "Alabama (Any City)",
  "Albuquerque, New Mexico, United States of America",
  "Arkansas (Any City)",
  "Bridgewater, Massachusetts, United States of America",
  "Copenhagen",
  "Hawaii (Any City)",
  "Horseheads, New York, United States of America",
  "Huntington Beach, California, United States of America",
  "Illinois (Any City)",
  "IN004 Bangalore",
  "IN014 Mumbai Mahim",
  "IN018 Gurgaon",
  "Incheon, Korea, Republic of",
  "Iowa (Any City)",
  "JP007 Tokyo J&J Headquarter",
  "JP162 Osaka Osaka",
  "Kansas (Any City)",
  "Los Gatos, California, United States of America",
  "Madrid - Lafinca",
  "Memphis, Tennessee, United States of America",
  "Milpitas, California, United States of America",
  "Minnesota (Any City)",
  "Missouri (Any City)",
  "Mooresville, Indiana, United States of America",
  "Mountain View, California, United States of America",
  "MX301 – Circuito Interior Norte - BWI",
  "Nebraska (Any City)",
  "New Brunswick, New Jersey, United States of America",
  "Oklahoma (Any City)",
  "Redwood City, California, United States of America",
  "Roanoke, Virginia, United States of America",
  "San Angelo, Texas, United States of America",
  "Santa Ana, California, United States of America",
  "Shepherdsville, Kentucky, United States of America",
  "Somerset, New Jersey, United States of America",
  "Somerville, New Jersey, United States of America",
  "Tamaulipas (Any City)",
  "Tennessee (Any City)",
  "Texas (Any City)",
  "US345  MA Danvers - 22 Cherry Hill Dr",
  "US356 CA Santa Clara - 5303 Betsy Ross Drive",
  "Wilson, North Carolina, United States of America",
  "Alberta (Any City)",
  "Bridgewater, New Jersey, United States of America",
  "Busan, Korea, Republic of",
  "GIMPO-SI, Korea, Republic of",
  "Pittsburgh, Pennsylvania, United States of America",
  "Trenton, New Jersey, United States of America",
  "Uşak"
] as const;

const GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES = [
  "Czech Republic - Prague",
  "UAE - Dubai",
  "United States – Remote"
] as const;

const BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES = [
  "AZ01 PSA Celgene - Phoenix - AZ",
  "CA06 PSA Celgene - San Diego Science Park - CA",
  "CA09 PSA Celgene - Los Angeles - CA",
  "CA10 PSA - Brisbane - CA",
  "CA14 San Diego Morehouse",
  "IN05 Indianapolis 80th Street",
  "MA01 PSA Cambridge Crossing - MA",
  "MD01 PSA Bethesda - FL",
  "NJ05 PSA New Brunswick - NJ",
  "NJ06 PSA Princeton LVL - NJ",
  "NJ09 PSA Princeton Pike - NJ",
  "NJ13 PSA Plainsboro - NJ",
  "NJ16 PSA Madison - Giralda Farms - NJ",
  "US99 PSA Field - United States",
  "WA04 PSA Celgene - Seattle Dexter Avenue - WA"
] as const;

const BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES = [
  "Korea, Republic Of",
  "United Kingdom (GB)"
] as const;

describe("createWorkdaySourceFetch", () => {
  it("retains exact Workday pages and official total evidence without promoting fetch completeness", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: 2,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset + 1}`,
            locationsText: "Shanghai, China",
            bulletFields: [`id-${offset + 1}`]
          }]
        }, offset === 0 ? "2026-07-08T00:00:01.000Z" : "2026-07-08T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { ...plan.workday, pageSize: 1, maxPages: 2 }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        artifacts: [
          { body: expect.stringContaining("Role One"), capturedAt: "2026-07-08T00:00:01.000Z" },
          { body: expect.stringContaining("Role Two"), capturedAt: "2026-07-08T00:00:02.000Z" }
        ],
        pages: [
          { sequence: 0, requestedOffset: 0, requestedPageSize: 1, returnedPageSize: null, rawJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], validJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], termination: "CONTINUE" },
          { sequence: 1, requestedOffset: 1, requestedPageSize: 1, returnedPageSize: null, rawJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], validJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], termination: "DECLARED_TOTAL_REACHED" }
        ],
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 2,
          artifactLogicalKey: "workday-page-0000",
          extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.total")),
          scope: "SOURCE"
        },
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false, derivedAnomalyCodes: [] }
    });
  });

  it("fails closed when injected Workday response metadata is incomplete", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 200, body: JSON.stringify({ total: 0, jobPostings: [] }) })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("evidence metadata")
    });
  });

  it("records parse and validation losses from exact raw Workday records", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 3,
        jobPostings: [
          "not-an-object",
          { title: "Missing location", externalPath: "/job/China/missing" },
          { title: "Valid", externalPath: "/job/China/valid", locationsText: "Shanghai, China", bulletFields: ["valid-id"] }
        ]
      })
    });

    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 2, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 1 },
        fetchLosses: [
          { stage: "PARSE", details: { code: "NON_OBJECT_RECORD", pageSequence: 0, recordIndex: 0 } },
          { stage: "VALIDATION", details: { code: "MISSING_REQUIRED_FIELD", field: "locationsText", pageSequence: 0, recordIndex: 1 } }
        ]
      }
    });
  });

  it("rejects records without record-level China evidence instead of trusting request facets", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 3,
        jobPostings: [
          { title: "US Role", externalPath: "/job/United-States/1", locationsText: "Boston, MA", bulletFields: ["us-1"] },
          { title: "China Role", externalPath: "/job/China/2", locationsText: "Shanghai, China", bulletFields: ["cn-2"] },
          { title: "Hinted China Role", externalPath: "/job/special-hint/3", locationsText: "Remote", bulletFields: ["hint-3"] }
        ]
      })
    });

    const result = await fetcher({
      ...plan,
      workday: { ...plan.workday, cityHints: { "special-hint": ["上海"] } }
    });
    expect(result).toMatchObject({
      ok: true,
      payload: { jobPostings: [
        { sourceJobId: workdayId("/job/China/2") },
        { sourceJobId: workdayId("/job/special-hint/3") }
      ] },
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 2, validationDiscardCount: 1 },
        fetchLosses: [{ stage: "VALIDATION", details: { code: "OUT_OF_SCOPE" } }]
      }
    });

    const unknownOnly = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 1,
        jobPostings: [{ title: "Unknown Role", externalPath: "/job/unknown/1", locationsText: "Remote", bulletFields: ["unknown-1"] }]
      })
    });
    await expect(unknownOnly(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("record-level China evidence"),
      fetchEvidence: expect.any(Object)
    });
  });

  it("keeps the entire emitted result free of credential material and unsafe upstream identifiers", async () => {
    const secret = "top-secret-value";
    const safeLookingBullet = "SAFE-REQ-4";
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 4,
        jobPostings: [
          { title: "Path attack", externalPath: `/job/China/token=${secret}`, locationsText: "China", bulletFields: ["safe-1"] },
          { title: `Medical Lead Bearer=${secret}`, externalPath: "/job/China/2", locationsText: "China", bulletFields: ["safe-2"] },
          { title: "Location attack", externalPath: "/job/China/3", locationsText: `China session:${secret}`, bulletFields: ["safe-3"] },
          { title: "Token Engineer", externalPath: "/job/China/4", locationsText: "Shanghai, China", bulletFields: [safeLookingBullet] }
        ]
      })
    });

    const result = await fetcher(plan);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence || !("payload" in result)) throw new Error("Expected evidence-backed JSON result");
    const resultWithOpaqueBodies = {
      ...result,
      fetchEvidence: {
        ...result.fetchEvidence,
        artifacts: result.fetchEvidence.artifacts.map((artifact) => ({ ...artifact, body: "<opaque>" }))
      }
    };
    const serialized = JSON.stringify(resultWithOpaqueBodies);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(safeLookingBullet);
    expect(result.payload).toMatchObject({
      jobPostings: [{
        sourceJobId: workdayId("/job/China/4"),
        title: "Token Engineer",
        officialUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China/4"
      }]
    });
    expect(result.fetchEvidence.fetchLosses.map((loss) => loss.details.code)).toEqual([
      "INVALID_EXTERNAL_PATH",
      "CREDENTIAL_MATERIAL",
      "CREDENTIAL_MATERIAL"
    ]);
    expect(result.fetchEvidence.fetchCounts).toEqual({
      rawCount: 4,
      parsedCount: 4,
      validCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 3
    });
    expect(result.fetchEvidence.fetchLosses[0]!.rawLocator).toMatch(/^workday-page-0000#page-0#record-0#sha256:[0-9a-f]{64}$/);
    expect(result.fetchEvidence.pages[0]!.rawJobIds.every((id) => /^sha256:[0-9a-f]{64}$/.test(id))).toBe(true);
    expect(result.fetchEvidence.pages[0]!.validJobIds.every((id) => /^sha256:[0-9a-f]{64}$/.test(id))).toBe(true);
  });

  it("fails native responses without an actual content-type instead of inventing a fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
      headers: { get: () => null },
      text: async () => JSON.stringify({ total: 0, jobPostings: [] })
    })));
    try {
      const fetcher = createWorkdaySourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z") });
      await expect(fetcher(plan)).resolves.toMatchObject({
        ok: false,
        failureReason: expect.stringContaining("evidence metadata")
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when Workday omits the official jobPostings array", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 0 })
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("jobPostings array")
    });
  });

  it("fails closed when a later Workday page changes the official total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 3,
          jobPostings: [{ title: `Role ${offset}`, externalPath: `/job/${offset}`, locationsText: "China", bulletFields: [`id-${offset}`] }]
        });
      }
    });
    await expect(fetcher({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED")
    });
  });

  it("fails closed on later raw zero totals without the exact audited source policy", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED")
    });
  });

  it("rejects the audited later-zero policy on any other source before transport", async () => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [] }));
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http
    });

    await expect(fetcher({
      ...plan,
      source: {
        ...plan.source,
        id: "source-non-audited-workday"
      },
      workday: {
        ...plan.workday,
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("not allowed for source")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("accepts later raw zero totals only after exact lossless reconciliation and preserves the zero evidence", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 3 : 0,
          jobPostings: [{
            title: `Role ${offset + 1}`,
            externalPath: `/job/China/role-${offset + 1}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 3
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3
      },
      fetchEvidence: {
        artifacts: [
          { body: expect.stringContaining('"total":3') },
          { body: expect.stringContaining('"total":0') },
          { body: expect.stringContaining('"total":0') }
        ],
        pages: [
          { sequence: 0, declaredTotal: 3 },
          { sequence: 1, declaredTotal: 0 },
          { sequence: 2, declaredTotal: 0 }
        ],
        fetchCounts: {
          rawCount: 3,
          parsedCount: 3,
          validCount: 3,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        }
      },
      paginationEvaluation: {
        safeCompleteness: true,
        verifiedEligible: false,
        derivedAnomalyCodes: []
      }
    });
  });

  it.each([
    {
      sourceId: "source-pfizer-china-social",
      tenant: "pfizer",
      site: "PfizerCareers",
      facetParameter: "Location_Country",
      facetDescriptor: "Location Country",
      policy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
    },
    {
      sourceId: "source-amgen-china-social",
      tenant: "amgen",
      site: "Careers",
      facetParameter: "LocationCountry",
      facetDescriptor: "Country/Territory",
      policy: "AMGEN_AUDITED_EXACT_RECONCILIATION"
    }
  ])("accepts fixed audited Workday metadata during exact later-zero reconciliation for $sourceId", async ({
    sourceId,
    tenant,
    site,
    facetParameter,
    facetDescriptor,
    policy
  }) => {
    const fixedFacets = [{
      facetParameter,
      descriptor: facetDescriptor,
      values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: 2 }]
    }];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }],
          facets: offset === 0 ? fixedFacets : [],
          userAuthenticated: false
        });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: sourceId },
      workday: {
        tenant,
        site,
        laterZeroTotalPolicy: policy,
        appliedFacets: { [facetParameter]: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 2
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2
      },
      paginationEvaluation: {
        safeCompleteness: true,
        verifiedEligible: false,
        derivedAnomalyCodes: []
      }
    });
  });

  it("rejects an identical but unaudited static facet envelope during later-zero reconciliation", async () => {
    const unauditedFacets = [{
      facetParameter: "unexpectedMetadata",
      descriptor: "Unexpected",
      values: [{ descriptor: "Static", id: "static-id", count: 2 }]
    }];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }],
          facets: unauditedFacets,
          userAuthenticated: false
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/TOTAL_CHANGED|DECLARED_CAPACITY_CONTRADICTION/)
    });
  });

  it.each([
    {
      name: "unknown top-level key",
      mutate: (body: Record<string, unknown>) => ({ ...body, error: "upstream partial response" })
    },
    {
      name: "changed facets",
      mutate: (body: Record<string, unknown>) => ({
        ...body,
        facets: [{ facetParameter: "Location_Country", descriptor: "Country", values: [] }]
      })
    },
    {
      name: "changed authentication state",
      mutate: (body: Record<string, unknown>) => ({ ...body, userAuthenticated: true })
    },
    {
      name: "partial audited metadata envelope",
      mutate: ({ userAuthenticated: _removed, ...body }: Record<string, unknown>) => body
    }
  ])("rejects $name during audited later-zero reconciliation", async ({ mutate }) => {
    const fixedFacets = [{
      facetParameter: "Location_Country",
      descriptor: "Location Country",
      values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: 2 }]
    }];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        const body: Record<string, unknown> = {
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }],
          facets: offset === 0 ? fixedFacets : [],
          userAuthenticated: false
        };
        return response(offset === 0 ? body : mutate(body));
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/TOTAL_CHANGED|DECLARED_CAPACITY_CONTRADICTION/)
    });
  });

  it.each([
    {
      name: "a facet object claims pagination authority",
      facets: [{
        facetParameter: "Location_Country",
        descriptor: "Location Country",
        total: 2,
        values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: 2 }]
      }],
      userAuthenticated: false
    },
    {
      name: "the response claims an authenticated session",
      facets: [],
      userAuthenticated: true
    }
  ])("rejects fixed audited metadata when $name", async ({ facets, userAuthenticated }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        const firstFacets = [{
          facetParameter: "Location_Country",
          descriptor: "Location Country",
          values: [{ descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", count: 2 }]
        }];
        return response({
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }],
          facets: offset === 0 ? firstFacets : facets,
          userAuthenticated: offset === 0 ? false : userAuthenticated
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/TOTAL_CHANGED|DECLARED_CAPACITY_CONTRADICTION/)
    });
  });

  it.each([
    {
      sourceId: "source-wrong-pfizer",
      tenant: "pfizer",
      site: "PfizerCareers",
      facetParameter: "Location_Country",
      policy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
    },
    {
      sourceId: "source-amgen-china-social",
      tenant: "amgen",
      site: "wrong-site",
      facetParameter: "LocationCountry",
      policy: "AMGEN_AUDITED_EXACT_RECONCILIATION"
    },
    {
      sourceId: "source-pfizer-china-social",
      tenant: "wrong-tenant",
      site: "PfizerCareers",
      facetParameter: "Location_Country",
      policy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
    },
    {
      sourceId: "source-amgen-china-social",
      tenant: "amgen",
      site: "Careers",
      facetParameter: "wrongFacet",
      policy: "AMGEN_AUDITED_EXACT_RECONCILIATION"
    }
  ])("rejects a later-zero policy outside its exact audited source/facet scope", async ({
    sourceId,
    tenant,
    site,
    facetParameter,
    policy
  }) => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [] }));
    const fetcher = createWorkdaySourceFetch({ http });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: sourceId },
      workday: {
        tenant,
        site,
        laterZeroTotalPolicy: policy,
        appliedFacets: { [facetParameter]: ["6cb77610a8a543aea2d6bc10457e35d4"] }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("not allowed for source")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects duplicate Workday total keys before applying the audited later-zero policy", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        if (offset === 0) {
          return response({
            total: 2,
            jobPostings: [{
              title: "Role One",
              externalPath: "/job/China/one",
              locationsText: "Shanghai, China"
            }]
          });
        }
        return response(
          '{"total":2,"total":0,"jobPostings":[{"title":"Role Two","externalPath":"/job/China/two","locationsText":"Shanghai, China"}]}'
        );
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("duplicate JSON object keys")
    });
  });

  it.each([
    { name: "error-shaped", extra: { error: "upstream partial response" } },
    { name: "facet-shaped", extra: { facets: [] } },
    { name: "authentication-shaped", extra: { userAuthenticated: false } }
  ])("fails closed on a non-first non-empty Workday zero total in a $name payload", async ({ extra }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          ...extra,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED"),
      fetchEvidence: {
        pages: [
          { sequence: 0, declaredTotal: 2 },
          { sequence: 1, declaredTotal: 0 }
        ]
      },
      paginationEvaluation: {
        safeCompleteness: false,
        derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED", "DECLARED_CAPACITY_CONTRADICTION"])
      }
    });
  });

  it("fails closed on a repeated final Workday response and on an intermediate empty page", async () => {
    const repeated = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 2, jobPostings: [{
        title: "Same", externalPath: "/job/same", locationsText: "China", bulletFields: ["same-id"]
      }] })
    });
    await expect(repeated({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/REPEATED_RESPONSE_FINGERPRINT|REPEATED_JOB_ID_SET_WITH_NEXT/),
      fetchEvidence: expect.any(Object)
    });

    const empty = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({ total: 3, jobPostings: offset === 0 ? [{
          title: "First", externalPath: "/job/first", locationsText: "China", bulletFields: ["first-id"]
        }] : [] });
      }
    });
    await expect(empty({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("INTERMEDIATE_EMPTY_PAGE")
    });
  });

  it("carries Workday fetch evidence unchanged and fails closed without STAGED authority", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 1, jobPostings: [{
        title: "Role", externalPath: "/job/China/1", locationsText: "Shanghai, China", bulletFields: ["id-1"]
      }] })
    });
    const fetched = await fetcher(plan);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) throw new Error(fetched.failureReason);
    expect(fetched.paginationEvaluation).toMatchObject({
      safeCompleteness: true,
      verifiedEligible: false
    });

    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result.status).toBe("SUCCESS");
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: false
    });
    expect(result.observation).toMatchObject({
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      expectedJobCount: 1,
      structuredJobCount: 1
    });
  });
  it("fetches paginated Workday jobs and enriches official urls and Chinese cities", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (body.offset === 0) {
          return response({
              total: 4,
              jobPostings: [
                {
                  title: "助理医学信息沟通专员",
                  externalPath: "/job/China---Shanghai---Shanghai/_4960384",
                  locationsText: "China - Shanghai - Shanghai",
                  bulletFields: ["4960384"]
                },
                {
                  title: "血友病客户解决方案大区经理",
                  externalPath: "/job/China---Beijing---Beijing/_4959317",
                  locationsText: "China - Beijing - Beijing",
                  bulletFields: ["4959317"]
                }
              ]
            });
        }

        return response({
            total: 4,
            jobPostings: [
              {
                title: "Site Admin",
                externalPath: "/job/China---Jiangsu---Suzhou/_4950000",
                locationsText: "China - Jiangsu - Suzhou",
                bulletFields: ["4950000"]
              },
              {
                title: "China Market Access Lead",
                externalPath: "/job/China-Remote/_4950001",
                locationsText: "China",
                bulletFields: ["4950001"]
              }
            ]
          });
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Shanghai---Shanghai/_4960384"),
            title: "助理医学信息沟通专员",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Shanghai---Shanghai/_4960384",
            locationRaw: "China - Shanghai - Shanghai",
            cities: ["上海"]
          },
          {
            sourceJobId: workdayId("/job/China---Beijing---Beijing/_4959317"),
            title: "血友病客户解决方案大区经理",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Beijing---Beijing/_4959317",
            locationRaw: "China - Beijing - Beijing",
            cities: ["北京"]
          },
          {
            sourceJobId: workdayId("/job/China---Jiangsu---Suzhou/_4950000"),
            title: "Site Admin",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Jiangsu---Suzhou/_4950000",
            locationRaw: "China - Jiangsu - Suzhou",
            cities: ["苏州"]
          },
          {
            sourceJobId: workdayId("/job/China-Remote/_4950001"),
            title: "China Market Access Lead",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China-Remote/_4950001",
            locationRaw: "China",
            cities: ["中国"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 4,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      }
    });

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 0
        })
      }),
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 2
        })
      })
    ]);
  });

  it("fails non-Workday plans before formal crawl", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(
      fetcher({
        ...plan,
        source: { ...plan.source, atsKind: "MOKA" }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday source fetch only supports WORKDAY sources"
    });
  });

  it("fails non-2xx Workday responses", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 500, body: "server error" })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday jobs API returned HTTP 500"
    });
  });

  it("exposes only reviewed transient Workday failures as structured retry signals", async () => {
    const unavailable = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 503, body: "temporarily unavailable" })
    });
    await expect(unavailable(plan)).resolves.toMatchObject({
      ok: false,
      transportFailure: { code: "OFFICIAL_HTTP_503", retryable: true }
    });

    const timedOut = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => { throw new OfficialHttpTimeoutError(); }
    });
    await expect(timedOut(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Official recruitment request timed out",
      transportFailure: { code: "OFFICIAL_HTTP_TIMEOUT", retryable: true }
    });
  });

  it("discovers China location facets instead of trusting broad Workday searchText totals", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (Array.isArray(body.appliedFacets?.locations)) {
          return response({
              total: 1,
              jobPostings: [
                {
                  title: "China Medical Role",
                  externalPath: "/job/China---Shanghai---Shanghai/China-Medical-Role_1",
                  locationsText: "Shanghai, China",
                  bulletFields: ["1"]
                }
              ]
            });
        }

        return response({
            total: 2,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locationMainGroup",
                values: [
                  {
                    facetParameter: "locations",
                    descriptor: "Locations",
                    values: [
                      { descriptor: "China - Shanghai", id: "china-location", count: 1 },
                      { descriptor: "United States - California", id: "us-location", count: 1 }
                    ]
                  }
                ]
              }
            ]
          });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        pageSize: 2,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: { jobPostings: [{
        sourceJobId: workdayId("/job/China---Shanghai---Shanghai/China-Medical-Role_1"),
        cities: ["上海"]
      }] },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
    if (!result.ok) throw new Error(result.failureReason);
    if (!result.fetchEvidence) throw new Error("Expected Workday fetch evidence");
    expect(result.fetchEvidence.pages).toHaveLength(1);
    expect(result.fetchEvidence.artifacts.map((artifact) => artifact.logicalKey)).toEqual([
      "workday-preflight-0000",
      "workday-page-0000"
    ]);
    expect(result.fetchEvidence.artifacts.every((artifact) => !("headers" in artifact))).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: {},
          limit: 2,
          offset: 0
        })
      })
    );
    expect(requests[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: { locations: ["china-location"] },
          limit: 2,
          offset: 0
        })
      })
    );
  });

  it("selects the unique country-level China facet without intersecting a city facet group", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (body.appliedFacets.Location_Country) {
          return response({
            total: 1,
            jobPostings: [{
              title: "China Country Role",
              externalPath: "/job/China---Shanghai/China-Country-Role_1",
              locationsText: "Shanghai, China",
              bulletFields: ["1"]
            }]
          });
        }
        return response({
          total: 3,
          jobPostings: [],
          facets: [
            {
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china-country", count: 1 },
                { descriptor: "United States", id: "us-country", count: 2 }
              ]
            },
            {
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                { descriptor: "Shanghai, China", id: "shanghai-city", count: 1 },
                { descriptor: "New York, United States", id: "new-york-city", count: 2 }
              ]
            }
          ]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2, maxPages: 2 }
    });

    expect(result).toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.body)).toEqual({
      appliedFacets: { Location_Country: ["china-country"] },
      limit: 2,
      offset: 0
    });
  });

  it("uses a unique exact China country id when sibling facet counts overlap without deriving a denominator", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (body.appliedFacets.Location_Country) {
          return response({
            total: 2,
            jobPostings: [
              { title: "China Role One", externalPath: "/job/China/one", locationsText: "Shanghai, China" },
              { title: "China Role Two", externalPath: "/job/China/two", locationsText: "Beijing, China" }
            ]
          });
        }
        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china-country", count: 2 },
              { descriptor: "United States", id: "us-country", count: 2 }
            ]
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 20 }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2
      }
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ Location_Country: ["china-country"] });
  });

  it("rejects overlapping country facets with more than one exact mainland-China request id", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "Location_Country",
          descriptor: "Location Country",
          values: [
            { descriptor: "China", id: "china-country", count: 2 },
            { descriptor: "CN", id: "cn-country", count: 1 },
            { descriptor: "United States", id: "us-country", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unique exact mainland-China request id")
    });
  });

  it("does not relax an under-counted country facet that may omit official jobs", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china-country", count: 1 },
              { descriptor: "United States", id: "us-country", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", maxPages: 1 }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("counts do not prove a complete partition")
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    {
      sourceId: "source-johnson-innovative-medicine-social",
      tenant: "jj",
      site: "JJ",
      policy: {
        kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
        foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    },
    {
      sourceId: "source-gilead-china-social",
      tenant: "gilead",
      site: "gileadcareers",
      policy: {
        kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    }
  ])("allows only the audited multi-location overlap for $sourceId without deriving a facet denominator", async ({
    sourceId,
    tenant,
    site,
    policy
  }) => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 2,
              jobPostings: [
                { title: "Shanghai Role", externalPath: "/job/China/shanghai", locationsText: "Shanghai, China" },
                { title: "Beijing Role", externalPath: "/job/China/beijing", locationsText: "Beijing, China" }
              ]
            })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  { descriptor: "Beijing, China", id: "beijing", count: 1 },
                  { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
                ]
              }]
            });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: sourceId },
      workday: {
        tenant,
        site,
        searchText: "China",
        locationFacetPolicy: policy,
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai", "beijing"] });
  });

  it("excludes the exact 2026-07-17 audited JNJ foreign descriptor drift from the China facet", async () => {
    const auditedForeignDrift = [
      ["Alberta (Any City)", "alberta"],
      ["Bridgewater, New Jersey, United States of America", "bridgewater-new-jersey"],
      ["Busan, Korea, Republic of", "busan"],
      ["GIMPO-SI, Korea, Republic of", "gimpo-si"],
      ["Pittsburgh, Pennsylvania, United States of America", "pittsburgh"],
      ["Trenton, New Jersey, United States of America", "trenton"],
      ["Uşak", "usak"]
    ] as const;
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{
                title: "Shanghai Role",
                externalPath: "/job/China/shanghai",
                locationsText: "Shanghai, China"
              }]
            })
          : response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  ...auditedForeignDrift.map(([descriptor, id]) => ({ descriptor, id, count: 1 }))
                ]
              }]
            });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: "source-johnson-innovative-medicine-social" },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        locationFacetPolicy: {
          kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
          foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 1 },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    expect(requests).toHaveLength(2);
    const appliedFacets = JSON.parse(requests[1]!.body).appliedFacets as Record<string, string[]>;
    expect(appliedFacets).toEqual({ locations: ["shanghai"] });
    expect(auditedForeignDrift.some(([, id]) => appliedFacets.locations?.includes(id))).toBe(false);
  });

  it.each([
    {
      sourceId: "source-johnson-innovative-medicine-social",
      tenant: "jj",
      site: "JJ",
      policy: {
        kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
        foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    },
    {
      sourceId: "source-gilead-china-social",
      tenant: "gilead",
      site: "gileadcareers",
      policy: {
        kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    }
  ])("keeps under-counted location facets fail-closed for $sourceId", async ({ sourceId, tenant, site, policy }) => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "locations",
            descriptor: "Locations",
            values: [
              { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
              { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: sourceId },
      workday: { tenant, site, searchText: "China", locationFacetPolicy: policy }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("counts do not prove a complete partition")
    });
    expect(requests).toHaveLength(1);
  });

  it("derives JNJ's audited China ids from the live facet and closes the official worker-subtype total across every page", async () => {
    const requests: Array<{ body: string }> = [];
    const ordinaryChinaDescriptors = [
      "Beijing, China",
      "Changchun, Jilin, China",
      "Changzhou, Jiangsu, China",
      "Chengdu, Sichuan, China",
      "Chongqing, China",
      "Fuzhou, Fujian, China",
      "Guangzhou, Guangdong, China",
      "Hangzhou, Zhejiang, China",
      "Jinan, Shandong, China",
      "Nanjing, Jiangsu, China",
      "Shanghai, China",
      "Shenyang, Liaoning, China",
      "Shenzhen, Guangdong, China",
      "Shijiazhuang, Hebei, China",
      "Suzhou, Jiangsu, China",
      "Urumqi, Xinjiang, China",
      "Wenzhou, Zhejiang, China",
      "Wuhan, Hubei, China",
      "Zhengzhou, Henan, China"
    ];
    const ordinaryChinaValues = ordinaryChinaDescriptors.map((descriptor, index) => ({
      descriptor,
      id: `live-china-${index}`,
      count: index === 0 ? 18 : 3
    }));
    const mainlandAliasValues = [
      { descriptor: "CN016 Harbin", id: "960db5386dc6460aafc4e8218049c650", count: 1 },
      { descriptor: "CN046 Zhengzhou", id: "46116f9f964140e7a43777ee6dc9f8bc", count: 1 }
    ];
    const pageJobs = Array.from({ length: 64 }, (_, index) => ({
      title: `China Role ${index + 1}`,
      externalPath: `/job/China/role-${index + 1}`,
      locationsText: "China",
      workerSubType: index < 2 ? "Fixed Term Employee (Non-Intern) (Fixed Term)" : "Regular"
    }));
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as {
          appliedFacets: Record<string, string[]>;
          offset: number;
          limit: number;
        };
        if (!body.appliedFacets.locations) {
          return response({
            total: 64,
            jobPostings: [],
            facets: [{
              facetParameter: "locationMainGroup",
              values: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  ...ordinaryChinaValues,
                  ...mainlandAliasValues,
                  ...JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
                    descriptor,
                    id: `live-foreign-${index}`,
                    count: 1
                  }))
                ]
              }]
            }]
          });
        }
        if (!body.appliedFacets.workerSubType) {
          return response({
            total: 68,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [
                {
                  descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)",
                  id: "fefc533227a447fea93bdad826d0e83e",
                  count: 2
                },
                { descriptor: "Regular", id: "a6a0d308752c44c78512478a6b330aa3", count: 62 },
                { descriptor: "College Recruit", id: "college-recruit-id", count: 2 },
                { descriptor: "Intern (Fixed Term)", id: "intern-id", count: 1 },
                { descriptor: "Temporary Agency Worker", id: "agency-id", count: 1 }
              ]
            }]
          });
        }
        return response({
          total: 64,
          jobPostings: pageJobs.slice(body.offset, body.offset + body.limit)
        });
      }
    });

    const result = await fetcher({
      ...plan,
      source: {
        ...plan.source,
        id: "source-johnson-innovative-medicine-social",
        officialEntryUrl: "https://jj.wd5.myworkdayjobs.com/JJ"
      },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        locationFacetPolicy: {
          kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
          foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Fixed Term Employee (Non-Intern) (Fixed Term)", "Regular"],
          excludedDescriptors: ["College Recruit", "Intern (Fixed Term)", "Temporary Agency Worker"]
        },
        pageSize: 20,
        maxPages: 4
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 64 },
      paginationEvaluation: { safeCompleteness: true }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected JNJ Workday payload");
    expect((result.payload as { jobPostings?: unknown[] }).jobPostings).toHaveLength(64);
    expect(requests).toHaveLength(6);
    expect(JSON.parse(requests[0]!.body).appliedFacets).toEqual({});
    const locationFilteredBody = JSON.parse(requests[1]!.body) as { appliedFacets: Record<string, string[]> };
    expect(locationFilteredBody.appliedFacets.locations).toEqual([
      ...ordinaryChinaValues.map(({ id }) => id),
      ...mainlandAliasValues.map(({ id }) => id)
    ]);
    expect(locationFilteredBody.appliedFacets.locations).not.toEqual(expect.arrayContaining(["live-foreign-0"]));
    const firstPageBody = JSON.parse(requests[2]!.body) as { appliedFacets: Record<string, string[]> };
    expect(firstPageBody.appliedFacets.workerSubType).toEqual([
      "fefc533227a447fea93bdad826d0e83e",
      "a6a0d308752c44c78512478a6b330aa3"
    ]);
    expect(firstPageBody.appliedFacets.workerSubType).not.toContain("college-recruit-id");
    expect(firstPageBody.appliedFacets.workerSubType).not.toContain("intern-id");
    expect(firstPageBody.appliedFacets.workerSubType).not.toContain("agency-id");
  });

  it("derives Gilead's China ids while accepting only its three source-bound foreign aliases", async () => {
    const requests: Array<{ body: string }> = [];
    const chinaValues = [
      "China - Beijing",
      "China - Chengdu",
      "China - Nanjing",
      "China - Nanning",
      "China - Shanghai",
      "China - Shenzhen",
      "China - Urumqi",
      "China - Wenzhou",
      "China - Wuhan",
      "China - Zhuhai"
    ].map((descriptor, index) => ({ descriptor, id: `live-gilead-china-${index}`, count: index === 0 ? 9 : 1 }));
    const jobs = Array.from({ length: 18 }, (_, index) => ({
      title: `Gilead China Role ${index + 1}`,
      externalPath: `/job/China/gilead-role-${index + 1}`,
      locationsText: "China",
      workerSubType: "Regular"
    }));
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (!body.appliedFacets.locations) {
          return response({
            total: 18,
            jobPostings: [],
            facets: [{
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                ...chinaValues,
                ...GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
                  descriptor,
                  id: `live-gilead-foreign-${index}`,
                  count: 1
                }))
              ]
            }]
          });
        }
        if (!body.appliedFacets.workerSubType) {
          return response({
            total: 18,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [{ descriptor: "Regular", id: "dda565f4c0a3100e1daf0357ae5f2b0c", count: 18 }]
            }]
          });
        }
        return response({ total: 18, jobPostings: jobs });
      }
    });

    const result = await fetcher({
      ...plan,
      source: {
        ...plan.source,
        id: "source-gilead-china-social",
        officialEntryUrl: "https://gilead.wd1.myworkdayjobs.com/gileadcareers"
      },
      workday: {
        tenant: "gilead",
        site: "gileadcareers",
        searchText: "China",
        locationFacetPolicy: {
          kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: { facetParameter: "workerSubType", allowedDescriptors: ["Regular"] },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 18 },
      paginationEvaluation: { safeCompleteness: true }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected Gilead Workday payload");
    expect((result.payload as { jobPostings?: unknown[] }).jobPostings).toHaveLength(18);
    expect(requests).toHaveLength(3);
    const locationFilteredBody = JSON.parse(requests[1]!.body) as { appliedFacets: Record<string, string[]> };
    expect(locationFilteredBody.appliedFacets.locations).toEqual(chinaValues.map(({ id }) => id));
    const pageBody = JSON.parse(requests[2]!.body) as { appliedFacets: Record<string, string[]> };
    expect(pageBody.appliedFacets.workerSubType).toEqual(["dda565f4c0a3100e1daf0357ae5f2b0c"]);
  });

  it("rejects audited descriptor aliases when the Gilead binding is incomplete", async () => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [], facets: [] }));
    const fetcher = createWorkdaySourceFetch({ http });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-gilead-china-social" },
      workday: {
        tenant: "gilead",
        site: "gileadcareers",
        searchText: "China",
        locationFacetPolicy: {
          kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES.slice(0, -1)
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("location facet policy is not allowed")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("keeps an unaudited Gilead descriptor drift fail-closed", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "China - Shanghai", id: "china", count: 1 },
            { descriptor: "United States — Remote", id: "drifted", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-gilead-china-social" },
      workday: {
        tenant: "gilead",
        site: "gileadcareers",
        searchText: "China",
        locationFacetPolicy: {
          kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unscoped location descriptor United States — Remote")
    });
  });

  it.each([
    "Albany, NY, United States of America",
    "CN999 Future Site"
  ])("keeps JNJ's unaudited descriptor drift fail-closed: %s", async (driftedDescriptor) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Shanghai, China", id: "china", count: 1 },
            { descriptor: driftedDescriptor, id: "drifted", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-johnson-innovative-medicine-social" },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        locationFacetPolicy: {
          kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
          foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining(`unscoped location descriptor ${driftedDescriptor}`)
    });
  });

  it("rejects Gilead's audited foreign alias when it appears beneath a mainland-China ancestor", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{
                title: "Contradictory Role",
                externalPath: "/job/China/contradictory-role",
                locationsText: "China"
              }]
            })
          : response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [{
                  descriptor: "China",
                  count: 1,
                  values: [{ descriptor: "Czech Republic - Prague", id: "foreign-under-china", count: 1 }]
                }]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-gilead-china-social" },
      workday: {
        tenant: "gilead",
        site: "gileadcareers",
        searchText: "China",
        locationFacetPolicy: {
          kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("conflicting mainland and foreign location boundaries")
    });
    expect(requests).toHaveLength(1);
  });

  it("rejects JNJ's audited mainland alias when it appears beneath a known foreign ancestor", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{
                title: "Contradictory Role",
                externalPath: "/job/China/contradictory-role",
                locationsText: "China"
              }]
            })
          : response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [{
                  descriptor: "United States",
                  count: 1,
                  values: [{ descriptor: "CN016 Harbin", id: "mainland-under-us", count: 1 }]
                }]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-johnson-innovative-medicine-social" },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        locationFacetPolicy: {
          kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
          foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("conflicting mainland and foreign location boundaries")
    });
    expect(requests).toHaveLength(1);
  });

  it("keeps Pfizer opaque records returned by the exact China and Regular facets only when strict details name the audited APAC site", async () => {
    const details = new Map([
      ["/job/India---Vizag/Associate-Manager---BQ-QMS---Compliance_4960738", {
        title: "Associate Manager - BQ QMS & Compliance",
        reqId: "4960738",
        location: "India - Vizag",
        additionalLocations: ["APAC - Any Pfizer Site", "India - Chennai"]
      }],
      ["/job/India---Vizag/Associate-Manager---Quality-Assurance_4958270-1", {
        title: "Associate Manager - Quality Assurance",
        reqId: "4958270",
        location: "India - Vizag",
        additionalLocations: ["APAC - Any Pfizer Site"]
      }]
    ]);
    const rawJobs = [...details.entries()].map(([externalPath, detail]) => ({
      title: detail.title,
      externalPath,
      locationsText: `${detail.additionalLocations.length + 1} Locations`,
      bulletFields: [detail.reqId]
    }));
    const detailRequests: string[] = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.workerSubType
          ? response({ total: 2, jobPostings: rawJobs }, undefined, { finalUrl: request.url })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "workerSubType",
                descriptor: "Job Type",
                values: [{ descriptor: "Regular", id: "regular-dynamic", count: 2 }]
              }]
            }, undefined, { finalUrl: request.url });
      },
      detailHttp: async (request) => {
        detailRequests.push(request.url);
        const externalPath = new URL(request.url).pathname.replace("/wday/cxs/pfizer/PfizerCareers", "");
        const detail = details.get(externalPath)!;
        return response({
          jobPostingInfo: {
            title: detail.title,
            jobPostingSiteId: "PfizerCareers",
            jobPostingId: externalPath.split("/").at(-1),
            jobReqId: detail.reqId,
            externalUrl: `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers${externalPath}`,
            posted: true,
            canApply: true,
            location: detail.location,
            additionalLocations: detail.additionalLocations
          }
        }, "2026-07-17T00:01:02.000Z", { finalUrl: request.url });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        opaqueMultiLocationDetailPolicy: "PFIZER_AUDITED_APAC_DETAIL_V1",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"]
        },
        pageSize: 20,
        maxPages: 10
      }
    } as unknown as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, validationDiscardCount: 0 },
        fetchLosses: []
      }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected hydrated Pfizer payload");
    expect(result.payload).toEqual({ jobPostings: rawJobs.map((raw) => ({
      sourceJobId: workdayId(raw.externalPath),
      title: raw.title,
      officialUrl: `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers${raw.externalPath}`,
      locationRaw: details.get(raw.externalPath)!
        ? [details.get(raw.externalPath)!.location, ...details.get(raw.externalPath)!.additionalLocations].join(" | ")
        : "",
      cities: ["APAC - Any Pfizer Site"]
    })) });
    expect(detailRequests).toHaveLength(2);
  });

  it.each([
    ["a broad APAC region", "APAC"],
    ["foreign-only locations", "Singapore"],
    ["an unknown location", "Unknown Global Site"]
  ])("keeps Pfizer opaque details fail-closed for %s", async (_caseName, additionalLocation) => {
    const externalPath = "/job/India---Vizag/Unscoped-Pfizer-Role_4000000";
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.workerSubType
          ? response({ total: 1, jobPostings: [{
              title: "Unscoped Pfizer Role",
              externalPath,
              locationsText: "2 Locations",
              bulletFields: ["4000000"]
            }] }, undefined, { finalUrl: request.url })
          : response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "workerSubType",
                descriptor: "Job Type",
                values: [{ descriptor: "Regular", id: "regular-dynamic", count: 1 }]
              }]
            }, undefined, { finalUrl: request.url });
      },
      detailHttp: async (request) => response({
        jobPostingInfo: {
          title: "Unscoped Pfizer Role",
          jobPostingSiteId: "PfizerCareers",
          jobPostingId: "Unscoped-Pfizer-Role_4000000",
          jobReqId: "4000000",
          externalUrl: `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers${externalPath}`,
          posted: true,
          canApply: true,
          location: "India - Vizag",
          additionalLocations: [additionalLocation]
        }
      }, "2026-07-17T00:01:02.000Z", { finalUrl: request.url })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        opaqueMultiLocationDetailPolicy: "PFIZER_AUDITED_APAC_DETAIL_V1",
        appliedFacets: { Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"] },
        facetDescriptorBoundary: { facetParameter: "workerSubType", allowedDescriptors: ["Regular"] },
        pageSize: 20,
        maxPages: 10
      }
    } as unknown as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("opaque multi-location detail validation failed")
    });
  });

  it.each([
    ["source", { sourceId: "source-wrong-pfizer", tenant: "pfizer", site: "PfizerCareers", countryId: "6cb77610a8a543aea2d6bc10457e35d4", worker: "Regular", laterZero: undefined }],
    ["tenant", { sourceId: "source-pfizer-china-social", tenant: "wrong", site: "PfizerCareers", countryId: "6cb77610a8a543aea2d6bc10457e35d4", worker: "Regular", laterZero: undefined }],
    ["site", { sourceId: "source-pfizer-china-social", tenant: "pfizer", site: "wrong", countryId: "6cb77610a8a543aea2d6bc10457e35d4", worker: "Regular", laterZero: undefined }],
    ["China country facet", { sourceId: "source-pfizer-china-social", tenant: "pfizer", site: "PfizerCareers", countryId: "wrong", worker: "Regular", laterZero: undefined }],
    ["Regular worker boundary", { sourceId: "source-pfizer-china-social", tenant: "pfizer", site: "PfizerCareers", countryId: "6cb77610a8a543aea2d6bc10457e35d4", worker: "Intern", laterZero: "PFIZER_AUDITED_EXACT_RECONCILIATION" }],
    ["later-zero policy", { sourceId: "source-pfizer-china-social", tenant: "pfizer", site: "PfizerCareers", countryId: "6cb77610a8a543aea2d6bc10457e35d4", worker: "Regular", laterZero: undefined }]
  ])("rejects Pfizer opaque detail policy binding drift before transport: %s", async (_caseName, binding) => {
    const http = vi.fn();
    const fetcher = createWorkdaySourceFetch({ http });
    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: binding.sourceId },
      workday: {
        tenant: binding.tenant,
        site: binding.site,
        ...(binding.laterZero ? { laterZeroTotalPolicy: binding.laterZero } : {}),
        opaqueMultiLocationDetailPolicy: "PFIZER_AUDITED_APAC_DETAIL_V1",
        appliedFacets: { Location_Country: [binding.countryId] },
        facetDescriptorBoundary: { facetParameter: "workerSubType", allowedDescriptors: [binding.worker] }
      }
    } as unknown as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("opaque multi-location detail policy is not allowed")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("hydrates JNJ's two opaque multi-location records from strict archived official details", async () => {
    const details = new Map([
      ["/job/Hong-Kong/CQRA_R-100", {
        title: "CQRA Specialist, HK",
        reqId: "R-100",
        location: "Hong Kong, Hong Kong",
        additionalLocations: ["Shanghai, China", "Beijing, China"]
      }],
      ["/job/India/Product-Analyst_R-200", {
        title: "Technical Product Analyst",
        reqId: "R-200",
        location: "Hyderabad, India",
        additionalLocations: ["Shanghai, China", "Bangalore, India"]
      }]
    ]);
    const rawJobs = [...details.entries()].map(([externalPath, detail]) => ({
      title: detail.title,
      externalPath,
      locationsText: "3 Locations",
      bulletFields: [detail.reqId]
    }));
    const detailRequests: string[] = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({ total: 2, jobPostings: rawJobs })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai-dynamic", count: 1 },
                  { descriptor: "Beijing, China", id: "beijing-dynamic", count: 1 }
                ]
              }]
            });
      },
      detailHttp: async (request) => {
        detailRequests.push(request.url);
        const externalPath = new URL(request.url).pathname.replace("/wday/cxs/jj/JJ", "");
        const detail = details.get(externalPath)!;
        return response({
          jobPostingInfo: {
            title: detail.title,
            jobPostingSiteId: "JJ",
            jobPostingId: externalPath.split("/").at(-1),
            jobReqId: detail.reqId,
            externalUrl: `https://jj.wd5.myworkdayjobs.com/JJ${externalPath}`,
            posted: true,
            canApply: true,
            location: detail.location,
            additionalLocations: detail.additionalLocations,
            jobRequisitionLocation: { descriptor: "must-not-be-authority" }
          }
        }, "2026-07-14T00:00:02.000Z", { finalUrl: request.url });
      }
    });

    const result = await fetcher({
      ...plan,
      source: {
        ...plan.source,
        id: "source-johnson-innovative-medicine-social",
        officialEntryUrl: "https://jj.wd5.myworkdayjobs.com/JJ"
      },
      workday: {
        tenant: "jj",
        site: "JJ",
        searchText: "China",
        opaqueMultiLocationDetailPolicy: "JNJ_AUDITED_CHINA_DETAIL_V1",
        locationFacetPolicy: {
          kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
          facetParameter: "locations",
          mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
          foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
        },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, validationDiscardCount: 0 },
        fetchLosses: []
      }
    });
    expect(result.fetchEvidence?.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalKey: "workday-detail-0000-0000", kind: "ATS_API_RESPONSE" }),
      expect.objectContaining({ logicalKey: "workday-detail-0000-0001", kind: "ATS_API_RESPONSE" })
    ]));
    if (!result.ok || !("payload" in result)) throw new Error("Expected hydrated JNJ payload");
    expect(result.payload).toEqual({
      jobPostings: [
        {
          sourceJobId: workdayId("/job/Hong-Kong/CQRA_R-100"),
          title: "CQRA Specialist, HK",
          officialUrl: "https://jj.wd5.myworkdayjobs.com/JJ/job/Hong-Kong/CQRA_R-100",
          locationRaw: "Hong Kong, Hong Kong | Shanghai, China | Beijing, China",
          cities: ["上海", "北京"]
        },
        {
          sourceJobId: workdayId("/job/India/Product-Analyst_R-200"),
          title: "Technical Product Analyst",
          officialUrl: "https://jj.wd5.myworkdayjobs.com/JJ/job/India/Product-Analyst_R-200",
          locationRaw: "Hyderabad, India | Shanghai, China | Bangalore, India",
          cities: ["上海"]
        }
      ]
    });
    expect(detailRequests).toHaveLength(2);
  });

  it("hydrates MSD's opaque multi-location record without changing its identity", async () => {
    const opaquePath = "/job/USA/MSD-Global-Role_R-300";
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{ title: "MSD Global Role", externalPath: opaquePath, locationsText: "2 Locations", bulletFields: ["R-300"] }]
            })
          : response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [{ descriptor: "Shanghai, China", id: "msd-shanghai-dynamic", count: 1 }]
              }]
            });
      },
      detailHttp: async (request) => response({
        jobPostingInfo: {
          title: "MSD Global Role",
          jobPostingSiteId: "SearchJobs",
          jobPostingId: "MSD-Global-Role_R-300",
          jobReqId: "R-300",
          externalUrl: `https://msd.wd5.myworkdayjobs.com/SearchJobs${opaquePath}`,
          posted: true,
          canApply: true,
          location: "Rahway, New Jersey, United States",
          additionalLocations: ["Shanghai, China"]
        }
      }, "2026-07-14T00:00:02.000Z", { finalUrl: request.url })
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: "source-msd-china-social", officialEntryUrl: "https://msd.wd5.myworkdayjobs.com/SearchJobs" },
      workday: {
        tenant: "msd",
        site: "SearchJobs",
        searchText: "China",
        opaqueMultiLocationDetailPolicy: "MSD_AUDITED_CHINA_DETAIL_V1",
        locationFacetPolicy: {
          kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
          facetParameter: "locations",
          allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
        },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1 }, fetchLosses: [] } });
    if (!result.ok || !("payload" in result)) throw new Error("Expected hydrated MSD payload");
    expect(result.payload).toEqual({ jobPostings: [{
      sourceJobId: workdayId(opaquePath),
      title: "MSD Global Role",
      officialUrl: `https://msd.wd5.myworkdayjobs.com/SearchJobs${opaquePath}`,
      locationRaw: "Rahway, New Jersey, United States | Shanghai, China",
      cities: ["上海"]
    }] });
  });

  it("fails closed without a detail client when POST transport is injected", async () => {
    const http = vi.fn(async (request) => {
      const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
      return body.appliedFacets.locations
        ? response({ total: 1, jobPostings: [{ title: "Opaque", externalPath: "/job/US/Opaque_R-1", locationsText: "2 Locations", bulletFields: ["R-1"] }] })
        : response({ total: 1, jobPostings: [], facets: [{ facetParameter: "locations", descriptor: "Locations", values: [{ descriptor: "Shanghai, China", id: "china", count: 1 }] }] });
    });
    const fetcher = createWorkdaySourceFetch({ http });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-msd-china-social", officialEntryUrl: "https://msd.wd5.myworkdayjobs.com/SearchJobs" },
      workday: {
        tenant: "msd",
        site: "SearchJobs",
        searchText: "China",
        opaqueMultiLocationDetailPolicy: "MSD_AUDITED_CHINA_DETAIL_V1",
        locationFacetPolicy: {
          kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
          facetParameter: "locations",
          allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("detail client")
    });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("derives MSD's dynamic China ids from its audited overlapping facet and closes the Regular total", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (!body.appliedFacets.locations) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                { descriptor: "CHN - Beijing - Beijing", id: "beijing-dynamic", count: 1 },
                { descriptor: "CHN - Shanghai - Shanghai", id: "shanghai-dynamic", count: 1 },
                { descriptor: "IND - Telangana - Hyderabad", id: "india-a", count: 1 },
                { descriptor: "IND - Telangana - Hyderabad", id: "india-b", count: 1 }
              ]
            }]
          });
        }
        if (!body.appliedFacets.workerSubType) {
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [{ descriptor: "Regular", id: "regular-dynamic", count: 2 }]
            }]
          });
        }
        return response({
          total: 2,
          jobPostings: [
            { title: "Beijing Role", externalPath: "/job/China/beijing", locationsText: "Beijing, China", workerSubType: "Regular" },
            { title: "Shanghai Role", externalPath: "/job/China/shanghai", locationsText: "Shanghai, China", workerSubType: "Regular" }
          ]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: "source-msd-china-social" },
      workday: {
        tenant: "msd",
        site: "SearchJobs",
        searchText: "China",
        locationFacetPolicy: {
          kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
          facetParameter: "locations",
          allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
        },
        facetDescriptorBoundary: { facetParameter: "workerSubType", allowedDescriptors: ["Regular"] },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 2 },
      paginationEvaluation: { safeCompleteness: true }
    });
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({
      locations: ["beijing-dynamic", "shanghai-dynamic"]
    });
    expect(JSON.parse(requests[2]!.body).appliedFacets).toEqual({
      locations: ["beijing-dynamic", "shanghai-dynamic"],
      workerSubType: ["regular-dynamic"]
    });
  });

  it.each([
    {
      name: "duplicate mainland-China descriptor",
      values: [
        { descriptor: "Shanghai, China", id: "china-a", count: 1 },
        { descriptor: "Shanghai, China", id: "china-b", count: 1 },
        { descriptor: "IND - Telangana - Hyderabad", id: "india", count: 1 }
      ]
    },
    {
      name: "unlisted duplicate foreign descriptor",
      values: [
        { descriptor: "Shanghai, China", id: "china", count: 1 },
        { descriptor: "USA - California", id: "usa-a", count: 1 },
        { descriptor: "USA - California", id: "usa-b", count: 1 }
      ]
    },
    {
      name: "duplicate id despite audited descriptor",
      values: [
        { descriptor: "Shanghai, China", id: "shared", count: 1 },
        { descriptor: "IND - Telangana - Hyderabad", id: "shared", count: 1 },
        { descriptor: "IND - Telangana - Hyderabad", id: "india-b", count: 1 }
      ]
    },
    {
      name: "audited foreign duplicate nested beneath mainland China",
      values: [
        {
          descriptor: "China",
          count: 2,
          values: [
            { descriptor: "IND - Telangana - Hyderabad", id: "india-a", count: 1 },
            { descriptor: "IND - Telangana - Hyderabad", id: "india-b", count: 1 }
          ]
        },
        { descriptor: "USA - California", id: "usa", count: 1 }
      ]
    }
  ])("keeps MSD $name fail-closed", async ({ values }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 3,
        jobPostings: [],
        facets: [{ facetParameter: "locations", descriptor: "Locations", values }]
      })
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-msd-china-social" },
      workday: {
        tenant: "msd",
        site: "SearchJobs",
        searchText: "China",
        locationFacetPolicy: {
          kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
          facetParameter: "locations",
          allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("duplicate descriptors or ids")
    });
  });

  it("keeps BMS site and country aliases distinct while deriving the dynamic China id and official filtered total", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (!body.appliedFacets.locationHierarchy2) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "locationHierarchy2",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china-dynamic", count: 2 },
                { descriptor: "France", id: "france", count: 1 },
                ...BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
                  descriptor,
                  id: `bms-site-${index}`,
                  count: 1
                })),
                ...BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
                  descriptor,
                  id: `bms-country-${index}`,
                  count: 1
                }))
              ]
            }]
          });
        }
        if (!body.appliedFacets.workerSubType) {
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [
                { descriptor: "Fixed Term (Fixed Term)", id: "fixed-term-dynamic", count: 1 },
                { descriptor: "Permanent", id: "permanent-dynamic", count: 1 }
              ]
            }]
          });
        }
        return response({
          total: 2,
          jobPostings: [
            { title: "China Role One", externalPath: "/job/China/one", locationsText: "Shanghai, China", workerSubType: "Permanent" },
            { title: "China Role Two", externalPath: "/job/China/two", locationsText: "Beijing, China", workerSubType: "Fixed Term (Fixed Term)" }
          ]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
        },
        pageSize: 20,
        maxPages: 1
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 2 },
      paginationEvaluation: { safeCompleteness: true }
    });
    expect(requests).toHaveLength(3);
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locationHierarchy2: ["china-dynamic"] });
    expect(JSON.parse(requests[2]!.body).appliedFacets).toEqual({
      locationHierarchy2: ["china-dynamic"],
      workerSubType: ["fixed-term-dynamic", "permanent-dynamic"]
    });
  });

  it("reconciles BMS later-zero pages only after re-proving its dynamic China and worker facets", async () => {
    const requests: Array<{ body: string }> = [];
    const jobs = Array.from({ length: 50 }, (_, index) => ({
      title: `BMS China Role ${index + 1}`,
      externalPath: `/job/China/bms-role-${index + 1}`,
      locationsText: index % 2 === 0 ? "Shanghai, China" : "Beijing, China",
      workerSubType: index < 46 ? "Fixed Term (Fixed Term)" : "Permanent"
    }));
    const locationFacet = {
      facetParameter: "locationMainGroup",
      values: [{
        facetParameter: "locationHierarchy2",
        descriptor: "Country",
        values: [
          { descriptor: "China", id: "china-dynamic", count: 50 },
          ...BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
            descriptor,
            id: `bms-site-${index}`,
            count: 1
          })),
          ...BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES.map((descriptor, index) => ({
            descriptor,
            id: `bms-country-${index}`,
            count: 1
          }))
        ]
      }]
    };
    const workerFacet = {
      facetParameter: "workerSubType",
      descriptor: "Job Type",
      values: [
        { descriptor: "Fixed Term (Fixed Term)", id: "fixed-term-dynamic", count: 46 },
        { descriptor: "Permanent", id: "permanent-dynamic", count: 4 }
      ]
    };
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]>; offset: number; limit: number };
        if (!body.appliedFacets.locationHierarchy2) {
          return response({ total: 50, jobPostings: [], facets: [locationFacet] });
        }
        if (!body.appliedFacets.workerSubType) {
          return response({ total: 50, jobPostings: [], facets: [workerFacet] });
        }
        return response({
          total: body.offset === 0 ? 50 : 0,
          jobPostings: jobs.slice(body.offset, body.offset + body.limit),
          facets: body.offset === 0 ? [locationFacet, workerFacet] : [],
          userAuthenticated: false
        });
      }
    });

    const result = await fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        laterZeroTotalPolicy: "BMS_AUDITED_EXACT_RECONCILIATION",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
        },
        pageSize: 20,
        maxPages: 5
      }
    } as SourceCrawlPlan);

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 50, pagesVisited: 3 },
      fetchEvidence: {
        fetchCounts: {
          rawCount: 50,
          parsedCount: 50,
          validCount: 50,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        },
        fetchLosses: []
      },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected exact BMS Workday payload");
    const emittedJobs = (result.payload as { jobPostings: Array<{ sourceJobId: string }> }).jobPostings;
    expect(emittedJobs).toHaveLength(50);
    expect(new Set(emittedJobs.map((job) => job.sourceJobId)).size).toBe(50);
    expect(requests).toHaveLength(5);
  });

  it.each([
    { name: "wrong source", mutate: (value: OfficialJsonSourceCrawlPlan) => ({ ...value, source: { ...value.source, id: "source-wrong-bms" } }) },
    { name: "wrong tenant", mutate: (value: OfficialJsonSourceCrawlPlan) => ({ ...value, workday: { ...value.workday!, tenant: "wrong" } }) },
    { name: "wrong site", mutate: (value: OfficialJsonSourceCrawlPlan) => ({ ...value, workday: { ...value.workday!, site: "wrong" } }) },
    { name: "wrong search text", mutate: (value: OfficialJsonSourceCrawlPlan) => ({ ...value, workday: { ...value.workday!, searchText: "china" } }) },
    { name: "reordered worker boundary", mutate: (value: OfficialJsonSourceCrawlPlan) => ({
      ...value,
      workday: {
        ...value.workday!,
        facetDescriptorBoundary: { facetParameter: "workerSubType", allowedDescriptors: ["Permanent", "Fixed Term (Fixed Term)"] }
      }
    }) }
  ])("rejects BMS later-zero binding drift before transport: $name", async ({ mutate }) => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [] }));
    const fetcher = createWorkdaySourceFetch({ http });
    const exactPlan = {
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        laterZeroTotalPolicy: "BMS_AUDITED_EXACT_RECONCILIATION",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
        }
      }
    } as OfficialJsonSourceCrawlPlan;

    await expect(fetcher(mutate(exactPlan))).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("not allowed for source")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "first page unknown top-level key",
      mutate: (body: Record<string, unknown>, offset: number) => offset === 0 ? { ...body, error: "drift" } : body
    },
    {
      name: "first page China count mismatch",
      mutate: (body: Record<string, unknown>, offset: number) => offset === 0 ? {
        ...body,
        facets: [{
          facetParameter: "locationHierarchy2",
          descriptor: "Country",
          values: [{ descriptor: "China", id: "china-dynamic", count: 2 }]
        }, (body.facets as unknown[])[1]]
      } : body
    },
    {
      name: "first page worker partition mismatch",
      mutate: (body: Record<string, unknown>, offset: number) => offset === 0 ? {
        ...body,
        facets: [(body.facets as unknown[])[0], {
          facetParameter: "workerSubType",
          descriptor: "Job Type",
          values: [
            { descriptor: "Fixed Term (Fixed Term)", id: "fixed-term-dynamic", count: 1 },
            { descriptor: "Permanent", id: "permanent-dynamic", count: 1 }
          ]
        }]
      } : body
    },
    {
      name: "later page nonempty facets",
      mutate: (body: Record<string, unknown>, offset: number) => offset > 0 ? {
        ...body,
        facets: [{ facetParameter: "workerSubType", descriptor: "Job Type", values: [] }]
      } : body
    },
    {
      name: "later page repeats official total",
      mutate: (body: Record<string, unknown>, offset: number) => offset > 0 ? { ...body, total: 3 } : body
    },
    {
      name: "later intermediate page is empty",
      mutate: (body: Record<string, unknown>, offset: number) => offset === 1 ? { ...body, jobPostings: [] } : body
    }
  ])("keeps BMS exact later-zero reconciliation fail-closed: $name", async ({ mutate }) => {
    const jobs = Array.from({ length: 3 }, (_, index) => ({
      title: `BMS Role ${index + 1}`,
      externalPath: `/job/China/bms-${index + 1}`,
      locationsText: "Shanghai, China",
      workerSubType: index < 2 ? "Fixed Term (Fixed Term)" : "Permanent"
    }));
    const locationFacet = {
      facetParameter: "locationHierarchy2",
      descriptor: "Country",
      values: [{ descriptor: "China", id: "china-dynamic", count: 3 }]
    };
    const workerFacet = {
      facetParameter: "workerSubType",
      descriptor: "Job Type",
      values: [
        { descriptor: "Fixed Term (Fixed Term)", id: "fixed-term-dynamic", count: 2 },
        { descriptor: "Permanent", id: "permanent-dynamic", count: 1 }
      ]
    };
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        const requestBody = JSON.parse(request.body) as { appliedFacets: Record<string, string[]>; offset: number };
        if (!requestBody.appliedFacets.locationHierarchy2) {
          return response({ total: 3, jobPostings: [], facets: [locationFacet] });
        }
        if (!requestBody.appliedFacets.workerSubType) {
          return response({ total: 3, jobPostings: [], facets: [workerFacet] });
        }
        const body: Record<string, unknown> = {
          total: requestBody.offset === 0 ? 3 : 0,
          jobPostings: [jobs[requestBody.offset]],
          facets: requestBody.offset === 0 ? [locationFacet, workerFacet] : [],
          userAuthenticated: false
        };
        return response(mutate(body, requestBody.offset));
      }
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        laterZeroTotalPolicy: "BMS_AUDITED_EXACT_RECONCILIATION",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
        },
        pageSize: 1,
        maxPages: 3
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({ ok: false });
  });

  it("rejects a BMS country descriptor outside the exact audited allowlist", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locationHierarchy2",
          descriptor: "Country",
          values: [
            { descriptor: "China", id: "china", count: 1 },
            { descriptor: "AZ02 Unknown Site - Phoenix - AZ", id: "unknown", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unscoped country descriptor AZ02 Unknown Site - Phoenix - AZ")
    });
  });

  it("rejects a BMS audited site descriptor when it drifts from a leaf into a parent node", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locationHierarchy2",
          descriptor: "Country",
          values: [
            { descriptor: "China", id: "china", count: 1 },
            {
              descriptor: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES[0],
              count: 1,
              values: [{ descriptor: "United States of America", id: "usa", count: 1 }]
            }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("audited foreign site descriptor must remain a leaf")
    });
  });

  it("rejects multiple requestable mainland-China ids for BMS even when counts form a partition", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "locationHierarchy2",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china", count: 1 },
              { descriptor: "CHN", id: "chn", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
          foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("lacks a unique exact mainland-China request id")
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    {
      name: "missing site alias",
      siteAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES.slice(0, -1),
      countryAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
    },
    {
      name: "extra site alias",
      siteAliases: [...BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES, "EXTRA SITE"],
      countryAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
    },
    {
      name: "reordered site aliases",
      siteAliases: [
        BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES[1],
        BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES[0],
        ...BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES.slice(2)
      ],
      countryAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
    },
    {
      name: "missing country alias",
      siteAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
      countryAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES.slice(0, -1)
    },
    {
      name: "extra country alias",
      siteAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
      countryAliases: [...BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES, "EXTRA COUNTRY"]
    },
    {
      name: "reordered country aliases",
      siteAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
      countryAliases: [
        BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES[1],
        BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES[0]
      ]
    },
    {
      name: "site and country classes swapped",
      siteAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES,
      countryAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES
    }
  ])("rejects BMS exact policy binding drift: $name", async ({ siteAliases, countryAliases }) => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [], facets: [] }));
    const fetcher = createWorkdaySourceFetch({ http });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: "source-bms-china-social" },
      workday: {
        tenant: "bristolmyerssquibb",
        site: "BMS",
        searchText: "China",
        locationFacetPolicy: {
          kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
          facetParameter: "locationHierarchy2",
          foreignSiteDescriptorAliases: siteAliases,
          foreignCountryDescriptorAliases: countryAliases
        }
      }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("location facet policy is not allowed")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "JNJ wrong source",
      sourceId: "source-wrong-johnson",
      tenant: "jj",
      site: "JJ",
      policy: {
        kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
        foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    },
    {
      name: "Gilead wrong facet",
      sourceId: "source-gilead-china-social",
      tenant: "gilead",
      site: "gileadcareers",
      policy: {
        kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "wrongFacet",
        foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    },
    {
      name: "JNJ wrong tenant",
      sourceId: "source-johnson-innovative-medicine-social",
      tenant: "wrong-tenant",
      site: "JJ",
      policy: {
        kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
        facetParameter: "locations",
        mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
        foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
      }
    },
    {
      name: "MSD wrong source",
      sourceId: "source-wrong-msd",
      tenant: "msd",
      site: "SearchJobs",
      policy: {
        kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
        facetParameter: "locations",
        allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
      }
    },
    {
      name: "BMS wrong facet",
      sourceId: "source-bms-china-social",
      tenant: "bristolmyerssquibb",
      site: "BMS",
      policy: {
        kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
        facetParameter: "wrongFacet",
        foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
        foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
      }
    },
    {
      name: "BMS wrong site",
      sourceId: "source-bms-china-social",
      tenant: "bristolmyerssquibb",
      site: "wrong-site",
      policy: {
        kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
        facetParameter: "locationHierarchy2",
        foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
        foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
      }
    }
  ])("rejects a location facet policy outside its exact audited scope: $name", async ({
    sourceId,
    tenant,
    site,
    policy
  }) => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [], facets: [] }));
    const fetcher = createWorkdaySourceFetch({ http });

    await expect(fetcher({
      ...plan,
      source: { ...plan.source, id: sourceId },
      workday: { tenant, site, searchText: "China", locationFacetPolicy: policy }
    } as SourceCrawlPlan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("location facet policy is not allowed")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("fails closed with the archived preflight when country-level China facets are ambiguous", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [
          {
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [{ descriptor: "China", id: "china-country", count: 1 }]
          },
          {
            facetParameter: "countryFacet",
            descriptor: "Country/Region",
            values: [{ descriptor: "China", id: "china-region", count: 1 }]
          }
        ]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("ambiguous country-level China location facets"),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-preflight-0000",
          extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")) }]
      }
    });
  });

  it("fails closed instead of treating searchText as completeness evidence when no China facet is proven", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 1,
        jobPostings: [],
        facets: [{
          facetParameter: "jobFamilyGroup",
          descriptor: "Job family",
          values: [{ descriptor: "Medical", id: "medical", count: 1 }]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("no authoritative China location facet"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
  });

  it("fails closed when multiple city-level China facet groups have equal authority", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [
          {
            facetParameter: "locations",
            descriptor: "Locations",
            values: [{ descriptor: "Shanghai, China", id: "shanghai", count: 1 }]
          },
          {
            facetParameter: "locationHierarchy2",
            descriptor: "Locations",
            values: [{ descriptor: "Beijing, China", id: "beijing", count: 1 }]
          }
        ]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("ambiguous city-level China location facets")
    });
  });

  it("fails closed when an explicit mainland-China city facet value has no selectable id", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
            { descriptor: "Beijing, China", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("contains a mainland-China descriptor without an id"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
  });

  it("fails closed when Workday ignores the discovered location facet total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({ total: 2, jobPostings: [] })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  { descriptor: "United States", id: "us", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday filtered total 2 did not match derived total 1",
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000" },
          { logicalKey: "workday-filter-validation-0000" }
        ]
      }
    });
  });

  it("selects every structurally explicit mainland city without a city allowlist", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 2,
              jobPostings: [
                { title: "Shanghai Role", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] },
                { title: "Chongqing Role", externalPath: "/job/China/Chongqing_2", locationsText: "Chongqing, China", bulletFields: ["2"] }
              ]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  { descriptor: "Chongqing, China", id: "chongqing", count: 1 },
                  { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2 }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 2 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai", "chongqing"] });
  });

  it("fails closed when a flat city group contains an unscoped descriptor", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 3,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
            { descriptor: "Chongqing", id: "chongqing", count: 1 },
            { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("unscoped location descriptor Chongqing") });
  });

  it("fails closed when authoritative facet values share an id across China and foreign branches", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "Location_Country",
          descriptor: "Country",
          values: [
            { descriptor: "China", id: "shared", count: 1 },
            { descriptor: "United States", id: "shared", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("duplicate descriptors or ids") });
  });

  it("fails closed before pagination when a country facet has an unowned Global or Remote branch", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china", count: 1 },
              { descriptor: "Global / Remote", id: "global-remote", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unscoped country descriptor Global / Remote"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
    expect(requests).toHaveLength(1);
  });

  it.each(["Acme / Georgia", "North America / Jordan", "Region / US"])(
    "rejects a country name or code embedded in a composite descriptor: %s",
    async (foreignDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china", count: 1 },
                { descriptor: foreignDescriptor, id: "foreign", count: 1 }
              ]
            }]
          });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining(`unscoped country descriptor ${foreignDescriptor}`) });
      expect(requests).toHaveLength(1);
    }
  );

  it.each(["Region / Hong Kong", "Acme / Taiwan", "North America / Macau"])(
    "rejects a non-mainland boundary embedded in a composite country descriptor: %s",
    async (boundaryDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china", count: 1 },
                { descriptor: boundaryDescriptor, id: "boundary", count: 1 }
              ]
            }]
          });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining(`unscoped country descriptor ${boundaryDescriptor}`) });
      expect(requests).toHaveLength(1);
    }
  );

  it.each(["Hong Kong", "HKG", "澳门", "MAC", "Taiwan", "TW"])(
    "accepts an exact non-mainland country boundary descriptor: %s",
    async (boundaryDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
          return body.appliedFacets.Location_Country
            ? response({
                total: 1,
                jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China", bulletFields: ["1"] }]
              })
            : response({
                total: 2,
                jobPostings: [],
                facets: [{
                  facetParameter: "Location_Country",
                  descriptor: "Country",
                  values: [
                    { descriptor: "China", id: "china", count: 1 },
                    { descriptor: boundaryDescriptor, id: "boundary", count: 1 }
                  ]
                }]
              });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
      expect(requests).toHaveLength(2);
    }
  );

  it.each([
    { name: "exact CLDR names", foreignDescriptors: ["Georgia", "Jordan"] },
    { name: "exact ISO alpha-2 codes", foreignDescriptors: ["US", "DE"] },
    { name: "exact ISO alpha-3 codes", foreignDescriptors: ["USA", "DEU"] }
  ])("accepts provable foreign country siblings from $name", async ({ foreignDescriptors }) => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({
              total: 1,
              jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China", bulletFields: ["1"] }]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  ...foreignDescriptors.map((descriptor, index) => ({ descriptor, id: `foreign-${index}`, count: 1 }))
                ]
              }]
            });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
  });

  it("accepts the exact official country descriptor United States of America", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({
              total: 1,
              jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China" }]
            })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  { descriptor: "United States of America", id: "usa", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "biogen", site: "External", searchText: "China" }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
  });

  it("rejects an unknown recursive country branch even when its counts partition", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china", count: 1 },
              {
                descriptor: "Worldwide",
                count: 1,
                values: [{ descriptor: "Remote", id: "remote", count: 1 }]
              }
            ]
          }]
        });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("unscoped country descriptor Remote") });
    expect(requests).toHaveLength(1);
  });

  it("selects requestable leaves from a nested locations to China hierarchy", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 2,
              jobPostings: [
                { title: "Shanghai Role", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] },
                { title: "Beijing Role", externalPath: "/job/China/Beijing_2", locationsText: "Beijing, China", bulletFields: ["2"] }
              ]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "locationMainGroup",
                values: [{
                  facetParameter: "locations",
                  descriptor: "Locations",
                  values: [
                    {
                      descriptor: "China",
                      count: 2,
                      values: [
                        { descriptor: "Shanghai", id: "shanghai", count: 1 },
                        { descriptor: "Beijing", id: "beijing", count: 1 }
                      ]
                    },
                    {
                      descriptor: "United States",
                      count: 1,
                      values: [{ descriptor: "New York", id: "new-york", count: 1 }]
                    }
                  ]
                }]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2 }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 2 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai", "beijing"] });
  });

  it("excludes Hong Kong, Macau and Taiwan leaves while proving the full facet partition", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{ title: "Shanghai", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] }]
            })
          : response({
              total: 5,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  { descriptor: "Hong Kong, China", id: "hong-kong", count: 1 },
                  { descriptor: "Macau, China", id: "macau", count: 1 },
                  { descriptor: "Taiwan, China", id: "taiwan", count: 1 },
                  { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai"] });
  });

  it.each([
    {
      name: "missing count",
      values: [
        { descriptor: "Shanghai, China", id: "shanghai" },
        { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
      ]
    },
    {
      name: "overlapping hierarchy counts",
      values: [{
        descriptor: "China",
        count: 2,
        values: [
          { descriptor: "Shanghai", id: "shanghai", count: 2 },
          { descriptor: "Beijing", id: "beijing", count: 2 }
        ]
      }]
    },
    {
      name: "non-integer count",
      values: [
        { descriptor: "Shanghai, China", id: "shanghai", count: 0.5 },
        { descriptor: "Tokyo, Japan", id: "tokyo", count: 1.5 }
      ]
    }
  ])("fails closed when location facet counts cannot prove a partition: $name", async ({ values }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{ facetParameter: "locations", descriptor: "Locations", values }]
      })
    });
    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("counts do not prove a complete partition") });
  });

  it("proves an exact allowed-descriptor Workday boundary before crawling", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        requests.push(body);
        const appliedFacets = body.appliedFacets as Record<string, string[]>;
        if (!appliedFacets.workerSubType) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [
                { descriptor: "Regular", id: "regular-id", count: 2 },
                { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "fixed-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:01.000Z");
        }
        return response({
          total: 3,
          jobPostings: [
            { title: "Role One", externalPath: "/job/China/one", locationsText: "Shanghai, China" },
            { title: "Role Two", externalPath: "/job/China/two", locationsText: "Beijing, China" },
            { title: "Role Three", externalPath: "/job/China/three", locationsText: "Suzhou, China" }
          ]
        }, "2026-07-13T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular", "Fixed Term Employee (Non-Intern) (Fixed Term)"]
        },
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({ ok: true, completeness: { expectedJobCount: 3 } });
    expect(requests).toEqual([
      { appliedFacets: { Location_Country: ["china-id"] }, limit: 20, offset: 0 },
      {
        appliedFacets: {
          Location_Country: ["china-id"],
          workerSubType: ["regular-id", "fixed-id"]
        },
        limit: 20,
        offset: 0
      }
    ]);
  });

  it.each([
    {
      name: "an unconfigured descriptor appears",
      values: [
        { descriptor: "Regular", id: "regular-id", count: 1 },
        { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "fixed-id", count: 1 },
        { descriptor: "Intern (Fixed Term)", id: "intern-id", count: 1 }
      ],
      reason: "unexpected descriptor Intern (Fixed Term)"
    },
    {
      name: "an allowed descriptor is missing",
      values: [{ descriptor: "Regular", id: "regular-id", count: 3 }],
      reason: "allowed descriptor Fixed Term Employee (Non-Intern) (Fixed Term) was missing"
    },
    {
      name: "descriptor ids overlap",
      values: [
        { descriptor: "Regular", id: "same-id", count: 2 },
        { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "same-id", count: 1 }
      ],
      reason: "duplicate descriptors or ids"
    }
  ])("fails closed when an allowed-descriptor Workday boundary drifts: $name", async ({ values, reason }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 3,
        jobPostings: [],
        facets: [{ facetParameter: "workerSubType", descriptor: "Job Type", values }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular", "Fixed Term Employee (Non-Intern) (Fixed Term)"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining(reason),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000",
          extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")) }],
        supportingArtifactOnlyFailure: { code: "FACET_DERIVATION_FAILED" }
      }
    });
  });

  it("fails closed when a Workday record exposes a job-type descriptor outside the proven facet boundary", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      http: async () => {
        requestNumber += 1;
        return requestNumber === 1
          ? response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "workerSubType",
                values: [{ descriptor: "Regular", id: "regular-id", count: 1 }]
              }]
            })
          : response({
              total: 1,
              jobPostings: [{
                title: "Role",
                externalPath: "/job/China/role",
                locationsText: "Shanghai, China",
                workerSubType: "Intern (Fixed Term)"
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("record workerSubType descriptor Intern (Fixed Term) is outside the proven boundary"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-facet-preflight-0000" },
          {
            logicalKey: "workday-record-boundary-validation-0000",
            body: expect.stringContaining("Intern (Fixed Term)")
          }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it("excludes an audited non-social Workday descriptor while keeping unknown descriptor drift fail-closed", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 4,
        jobPostings: [],
        facets: [{
          facetParameter: "workerSubType",
          descriptor: "Job Type",
          values: [
            { descriptor: "Regular", id: "regular-id", count: 2 },
            { descriptor: "College Recruit", id: "college-recruit-id", count: 1 },
            { descriptor: "Contractor", id: "unknown-id", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"],
          excludedDescriptors: ["College Recruit"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unexpected descriptor Contractor")
    });
  });

  it("derives positive Workday facet ids from an archived preflight and uses the filtered official total", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as {
          appliedFacets: Record<string, string[]>;
          offset: number;
        };
        if (body.appliedFacets.jobFamilyGroup) {
          expect(body.appliedFacets.jobFamilyGroup).toEqual(["medical-id", "commercial-id"]);
          return response({
            total: 2,
            jobPostings: [
              {
                title: "Medical Role",
                externalPath: "/job/China---Shanghai/medical",
                locationsText: "Shanghai, China",
                bulletFields: ["medical"]
              },
              {
                title: "Commercial Role",
                externalPath: "/job/China---Beijing/commercial",
                locationsText: "Beijing, China",
                bulletFields: ["commercial"]
              }
            ]
          }, "2026-07-13T00:00:02.000Z");
        }

        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "jobFamilyGroup",
            descriptor: "Job Family Group",
            values: [
              { descriptor: "Medical", id: "medical-id", count: 1 },
              { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 },
              { descriptor: "Commercial", id: "commercial-id", count: 1 }
            ]
          }]
        }, "2026-07-13T00:00:01.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        artifacts: [
          {
            logicalKey: "workday-facet-preflight-0000",
            kind: "ATS_API_RESPONSE",
            extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")),
            body: expect.stringContaining("Vocational & Development Programs")
          },
          { logicalKey: "workday-page-0000", body: expect.stringContaining('"total":2') }
        ],
        declaredCompleteness: { value: 2, artifactLogicalKey: "workday-page-0000" }
      }
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      appliedFacets: { Location_Country: ["china-id"] },
      limit: 20,
      offset: 0
    });
    expect(JSON.parse(requests[1]!.body)).toEqual({
      appliedFacets: {
        Location_Country: ["china-id"],
        jobFamilyGroup: ["medical-id", "commercial-id"]
      },
      limit: 20,
      offset: 0
    });
  });

  it("discovers geography before a dedicated facet preflight and includes categories absent from the search subset", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        bodies.push(body);
        const appliedFacets = body.appliedFacets as Record<string, string[]>;
        if (bodies.length === 1) {
          return response({
            total: 4,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locations",
                descriptor: "Locations",
                values: [{ descriptor: "Shanghai, China", id: "shanghai-id", count: 4 }]
              },
              {
                facetParameter: "jobFamilyGroup",
                descriptor: "Job Family Group",
                values: [{ descriptor: "Medical", id: "medical-id", count: 2 }]
              }
            ]
          }, "2026-07-13T00:00:01.000Z");
        }
        if (!appliedFacets.jobFamilyGroup) {
          return response({
            total: 4,
            jobPostings: [],
            facets: [{
              facetParameter: "jobFamilyGroup",
              descriptor: "Job Family Group",
              values: [
                { descriptor: "Medical", id: "medical-id", count: 1 },
                { descriptor: "Commercial", id: "commercial-id", count: 2 },
                { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:02.000Z");
        }
        expect(appliedFacets.jobFamilyGroup).toEqual(["medical-id", "commercial-id"]);
        return response({
          total: 3,
          jobPostings: [
            { title: "Medical", externalPath: "/job/China/medical", locationsText: "Shanghai, China" },
            { title: "Commercial One", externalPath: "/job/China/commercial-1", locationsText: "Shanghai, China" },
            { title: "Commercial Two", externalPath: "/job/China/commercial-2", locationsText: "Shanghai, China" }
          ]
        }, "2026-07-13T00:00:03.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        searchText: "China",
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 3 },
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000", body: expect.stringContaining("shanghai-id") },
          { logicalKey: "workday-facet-preflight-0000", body: expect.stringContaining("commercial-id") },
          { logicalKey: "workday-page-0000", body: expect.stringContaining('"total":3') }
        ]
      }
    });
    expect(bodies).toEqual([
      { appliedFacets: {}, limit: 20, offset: 0 },
      { appliedFacets: { locations: ["shanghai-id"] }, limit: 20, offset: 0 },
      {
        appliedFacets: {
          locations: ["shanghai-id"],
          jobFamilyGroup: ["medical-id", "commercial-id"]
        },
        limit: 20,
        offset: 0
      }
    ]);
  });

  it("fails before worker-type derivation when its preflight total exceeds the location-derived baseline", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      http: async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                { descriptor: "Shanghai, China", id: "shanghai-id", count: 1 },
                { descriptor: "Tokyo, Japan", id: "tokyo-id", count: 1 }
              ]
            }]
          });
        }
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "workerSubType",
            descriptor: "Job Type",
            values: [
              { descriptor: "Regular", id: "regular-id", count: 1 },
              { descriptor: "Intern (Fixed Term)", id: "intern-id", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("social facet preflight total 2 did not match location-derived total 1"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000" },
          { logicalKey: "workday-facet-preflight-0000" }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it("fails closed with evidence when Workday ignores the derived positive facet ids", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "jobFamilyGroup",
              values: [
                { descriptor: "Medical", id: "medical-id", count: 2 },
                { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:01.000Z");
        }
        return response({
          total: 3,
          jobPostings: [
            { title: "Medical", externalPath: "/job/China/medical", locationsText: "Shanghai, China" },
            { title: "Development", externalPath: "/job/China/development", locationsText: "Shanghai, China" }
          ]
        }, "2026-07-13T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("filtered total 3 did not match derived total 2"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-facet-preflight-0000",
            extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")) },
          { logicalKey: "workday-filter-validation-0000", body: expect.stringContaining('"total":3') }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it.each([
    {
      name: "missing counts",
      total: 2,
      values: [
        { descriptor: "Medical", id: "medical-id" },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
      ]
    },
    {
      name: "malformed counts",
      total: 2,
      values: [
        { descriptor: "Medical", id: "medical-id", count: 1.5 },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 0.5 }
      ]
    },
    {
      name: "nonpartition counts",
      total: 3,
      values: [
        { descriptor: "Medical", id: "medical-id", count: 1 },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
      ]
    }
  ])("fails closed when Workday facet $name cannot prove a complete partition", async ({ total, values }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total,
        jobPostings: [],
        facets: [{ facetParameter: "jobFamilyGroup", values }]
      })
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }]
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("complete partition"),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000",
          extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")) }],
        supportingArtifactOnlyFailure: { code: "FACET_DERIVATION_FAILED" }
      }
    });
  });

  it.each([
    {
      name: "descriptor drift",
      facets: [{ facetParameter: "jobFamilyGroup", values: [{ descriptor: "Renamed Development Programs", id: "development-id" }] }],
      reason: "excluded descriptor"
    },
    {
      name: "missing facet ids",
      facets: [{ facetParameter: "jobFamilyGroup", values: [{ descriptor: "Medical" }, { descriptor: "Vocational & Development Programs", id: "development-id" }] }],
      reason: "missing an id"
    },
    {
      name: "facet drift",
      facets: [{ facetParameter: "jobCategory", values: [{ descriptor: "Vocational & Development Programs", id: "development-id" }] }],
      reason: "facet parameter"
    }
  ])("fails closed on Workday facet exclusion $name", async ({ facets, reason }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({ total: 1, jobPostings: [], facets })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }]
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining(reason),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000",
          extractorLocator: expect.stringMatching(requestContractLocatorPattern("$.facets")) }]
      }
    });
  });

  it("merges discovered China location facets with configured business facets", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (Array.isArray(body.appliedFacets?.locations)) {
          return response({
              total: 1,
              jobPostings: [
                {
                  title: "China Pharmaceutical Sales",
                  externalPath: "/job/China---Shanghai---Shanghai/China-Pharma_1",
                  locationsText: "Shanghai, China",
                  bulletFields: ["1"]
                }
              ]
            });
        }

        return response({
            total: 2,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locationMainGroup",
                values: [
                  {
                    facetParameter: "locations",
                    descriptor: "Locations",
                    values: [
                      { descriptor: "Shanghai, China", id: "china-location", count: 1 },
                      { descriptor: "Tokyo, Japan", id: "japan-location", count: 1 }
                    ]
                  }
                ]
              }
            ]
          });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        appliedFacets: { jobFamilyGroup: ["pharma-category"] },
        pageSize: 2,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Shanghai---Shanghai/China-Pharma_1"),
            title: "China Pharmaceutical Sales",
            cities: ["上海"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: { jobFamilyGroup: ["pharma-category"] },
          limit: 2,
          offset: 0
        })
      })
    );
    expect(requests[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: {
            jobFamilyGroup: ["pharma-category"],
            locations: ["china-location"]
          },
          limit: 2,
          offset: 0
        })
      })
    );
  });

  it("infers cities from Workday external paths when the location label is generic", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
          total: 1,
          jobPostings: [
            {
              title: "MA Expert",
              externalPath: "/job/China---Beijing---Beijing/MA-Expert_4960057",
              locationsText: "2 Locations",
              bulletFields: ["4960057"]
            }
          ]
        })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Beijing---Beijing/MA-Expert_4960057"),
            locationRaw: "2 Locations",
            cities: ["北京"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
  });

  it("marks Workday crawls incomplete when maxPages stops before the official total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
          total: 52,
          jobPostings: [
            {
              title: "China Medical Role",
              externalPath: "/job/China---Shanghai---Shanghai/_1",
              locationsText: "China - Shanghai - Shanghai",
              bulletFields: ["1"]
            }
          ]
        })
    });

    await expect(
      fetcher({
        ...plan,
        workday: { ...plan.workday, pageSize: 20, maxPages: 1 }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("MAX_PAGES_WITH_NEXT")
    });
  });
});
