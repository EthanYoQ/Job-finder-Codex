import { organonBootstrapLocator } from "../../src/crawler/organonOfficialPostedDate";
import { organonBootstrap, organonRow } from "../fixtures/organonChinaQuality";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import {
  buildStagedSourceCrawlPlans,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { createNovoSingleJobHttp } from "../helpers/novoSingleJobFixture";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence,
  type PaginationEvaluation
} from "../../src/crawler/paginationEvidence";
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import {
  irreversibleOfficialJsonEvidenceId,
  persistentOfficialJsonJobId
} from "../../src/crawler/officialJsonEvidence";

const CAPTURED_AT = "2026-07-15T00:01:00.000Z";
// Generic Phenom fixtures use Organon. Lilly requires the dedicated full raw-to-output fixture.
const PLANS = buildStagedSourceCrawlPlans(candidateCompanies);
const WORKDAY_SOURCES = [
  "source-biogen-china-social"
] as const;
const PHENOM_SOURCES = [
  "source-organon-china-social",
  "source-ucb-china-social"
] as const;
const GENERIC_LOCATION_PHENOM_SOURCES = [
  "source-organon-china-social",
  "source-ucb-china-social"
] as const;
const GENERIC_LOCATION_VALUES = [
  "Remote",
  "Multiple Locations",
  "Various Locations",
  "Global",
  "Hybrid"
] as const;

type Artifact = PersistentSourceFetchEvidence["artifacts"][number];

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = structuredClone(PLANS.find((candidate) => candidate.source.id === sourceId));
  if (!plan) throw new Error(`Missing staged plan ${sourceId}`);
  return plan;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function requestLocator(base: string, input: {
  family: "workday" | "phenom";
  role: string;
  method: "POST";
  url: string;
  body: unknown;
  coordinate: unknown;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(canonical({ v: 2, ...input })), "utf8")
    .digest("hex");
  return `${base}|request-contract-v2|sha256:${digest}`;
}

function artifact(input: {
  logicalKey: string;
  kind: Artifact["kind"];
  url: string;
  body: string;
  locator: string;
  contentType?: string;
}): Artifact {
  return {
    id: input.logicalKey,
    logicalKey: input.logicalKey,
    kind: input.kind,
    requestedUrl: input.url,
    finalUrl: input.url,
    httpStatus: 200,
    contentType: input.contentType ?? "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT,
    body: input.body,
    bodyRepresentation: "EXACT",
    extractorLocator: input.locator
  };
}

function payloadFor(plan: SourceCrawlPlan, ids: readonly string[] = ["job-1"]): unknown {
  if (plan.adapterId !== "official-json" || !plan.json.jobsPath) throw new Error("official-json plan expected");
  const rows = ids.map((id) => {
    const row: Record<string, unknown> = {};
    const values: Record<string, unknown> = {
      sourceJobId: id,
      officialTitle: `Official role ${id}`,
      officialUrl: new URL(`/jobs/${id}`, plan.source.officialEntryUrl).toString(),
      locationRaw: "上海，中国",
      cities: ["上海"],
      category: "其他",
      officialPublishedAt: "2026-07-15"
    };
    for (const [field, configuredPath] of Object.entries(plan.json.fields)) {
      if (!configuredPath || !(field in values)) continue;
      for (const path of typeof configuredPath === "string" ? [configuredPath] : configuredPath) {
        const segments = path.split(".");
        let cursor = row;
        for (const segment of segments.slice(0, -1)) {
          const child = cursor[segment];
          if (!child || typeof child !== "object" || Array.isArray(child)) cursor[segment] = {};
          cursor = cursor[segment] as Record<string, unknown>;
        }
        cursor[segments.at(-1)!] = values[field];
      }
    }
    return row;
  });
  const payload: Record<string, unknown> = {};
  const jobsPath = typeof plan.json.jobsPath === "string"
    ? plan.json.jobsPath
    : plan.json.jobsPath[0];
  if (!jobsPath) throw new Error("Fixture requires one jobs path");
  const segments = jobsPath.split(".");
  let cursor = payload;
  for (const segment of segments.slice(0, -1)) {
    cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = rows;
  return payload;
}

function workdayLocationFixture(plan: SourceCrawlPlan): {
  total: number;
  facetParameter: string;
  values: Array<Record<string, unknown>>;
  selectedIds: string[];
} {
  if (plan.adapterId !== "official-json" || !plan.workday) throw new Error("Workday plan expected");
  return {
    total: 3,
    facetParameter: "locationCountry",
    values: [
      { descriptor: "China", id: "china-country", count: 1 },
      { descriptor: "United States of America", id: "foreign-us", count: 2 }
    ],
    selectedIds: ["china-country"]
  };
}

function dynamicWorkdayEvidence(plan: SourceCrawlPlan): {
  evidence: PersistentSourceFetchEvidence;
  evaluation: PaginationEvaluation;
} {
  if (plan.adapterId !== "official-json" || !plan.workday) throw new Error("Workday plan expected");
  const config = plan.workday;
  const pageSize = !config.pageSize || !Number.isFinite(config.pageSize)
    ? 20 : Math.min(20, Math.max(1, Math.floor(config.pageSize)));
  const url = new URL(`/wday/cxs/${config.tenant}/${config.site}/jobs`, plan.source.officialEntryUrl).toString();
  const pageBody = JSON.stringify({
    total: 1,
    jobPostings: [{
      title: "Medical role",
      externalPath: "/job/China/medical-role_1",
      locationsText: "Shanghai, China",
      bulletFields: ["1"]
    }],
    facets: []
  });
  const pageRequestBody = {
    appliedFacets: { ...(config.appliedFacets ?? {}) },
    limit: pageSize,
    offset: 0
  };
  const pageLocator = requestLocator("$.total", {
    family: "workday", role: "page", method: "POST", url,
    body: pageRequestBody,
    coordinate: { sequence: 0, requestedOffset: 0, requestedPage: 0, requestedPageSize: pageSize }
  });
  const raw = {
    captureTool: { name: "strict-dynamic-total-test", version: "1" },
    artifacts: [
      artifact({ logicalKey: "workday-page-0000", kind: "PAGINATION_PAGE", url, body: pageBody, locator: pageLocator })
    ],
    pages: [{
      sequence: 0,
      artifactLogicalKey: "workday-page-0000",
      requestedOffset: 0,
      returnedOffset: 0,
      requestedPage: 0,
      returnedPage: 0,
      requestedPageSize: pageSize,
      returnedPageSize: null,
      rawJobIds: ["raw-1"],
      validJobIds: ["valid-1"],
      declaredTotal: 1,
      declaredCount: null,
      declaredPages: 1,
      nextPageSignalBefore: null,
      nextPageSignalAfter: null,
      responseFingerprintSha256: createHash("sha256").update(pageBody).digest("hex"),
      termination: "DECLARED_TOTAL_REACHED" as const,
      anomalyCodes: [],
      capturedAt: CAPTURED_AT
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT" as const,
      value: 1,
      artifactLogicalKey: "workday-page-0000",
      extractorLocator: pageLocator,
      scope: "SOURCE" as const
    },
    fetchCounts: {
      rawCount: 1, parsedCount: 1, validCount: 1,
      parseDiscardCount: 0, validationDiscardCount: 0
    },
    fetchLosses: []
  };
  const evidence = deriveCanonicalPaginationEvidence({ evidence: raw, expectedChannelIds: [], filteredOutput: true });
  return { evidence, evaluation: evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true }) };
}

function phenomConfig(plan: SourceCrawlPlan) {
  if (plan.source.id === "source-organon-china-social") return {...organonBootstrap,absUrl:true,siteType:"external"};
  if (plan.source.id === "source-ucb-china-social") return {
    widgetApiEndpoint: "https://careers.ucb.com/widgets", country: "global", deviceType: "desktop",
    locale: "zh_global", absUrl: true, refNum: "UCB1GLOBAL", pageName: "search-results",
    siteType: "external", pageId: "page17"
  };
  if (plan.source.id === "source-roche-china-social") {
    return {
      widgetApiEndpoint: "https://careers.roche.com/widgets",
      country: "cn",
      deviceType: "desktop",
      locale: "zh_cn",
      absUrl: true,
      refNum: "ROCHGLOBAL",
      pageName: "search-results",
      siteType: "external",
      pageId: "page11-ds"
    };
  }
  return {
    widgetApiEndpoint: new URL("/widgets", plan.source.officialEntryUrl).toString(),
    country: "cn",
    deviceType: "desktop",
    locale: "en_global",
    absUrl: true,
    refNum: "STRICT-FIXTURE",
    pageName: "search-results",
    siteType: "external",
    pageId: "page18"
  };
}

function phenomRequestBody(
  config: ReturnType<typeof phenomConfig>,
  size: number,
  from: number,
  selectedFields: Record<string, string[]>
): Record<string, unknown> {
  return {
    lang: config.locale, locale: config.locale, deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from, jobs: true, counts: true,
    all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
    clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: config.pageId,
    siteType: "external", keywords: "", global: true, selected_fields: selectedFields,
    sort: { order: "desc", field: "postedDate" }, locationData: {}, refNum: config.refNum,
    ddoKey: "refineSearch"
  };
}

function phenomJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: "1",
    title: "Medical role",
    country: "China",
    city: "Shanghai",
    location: "Shanghai, China",
    category: "Sales",
    ...overrides
  };
}

function phenomEvidence(
  plan: SourceCrawlPlan,
  entryBody?: string,
  jobOverrides: Record<string, unknown> = {}
): {
  evidence: PersistentSourceFetchEvidence;
  evaluation: PaginationEvaluation;
} {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") {
    throw new Error("Phenom plan expected");
  }
  const strategy = plan.officialJsonFetch;
  const exactRoche = plan.source.id === "source-roche-china-social";
  const exactUcb = plan.source.id === "source-ucb-china-social";
  const exactOrganon = plan.source.id === "source-organon-china-social";
  const config = phenomConfig(plan);
  const endpoint = config.widgetApiEndpoint;
  const pageSize = Math.max(1, Math.min(exactRoche ? 250 : 100, strategy.pageSize ?? 50));
  const exactCountry = strategy.facetScope?.countryIncludeDescriptor ?? strategy.countryFilter ?? "China";
  const artifacts: Artifact[] = [];
  const entryUrl = new URL(plan.source.officialEntryUrl);
  for (const key of [...entryUrl.searchParams.keys()]) {
    if (["keyword", "keywords"].includes(key.normalize("NFKC").toLowerCase())) entryUrl.searchParams.delete(key);
  }
  artifacts.push(artifact({
    logicalKey: "phenom-entry-0000",
    kind: "OFFICIAL_COMPANY_PAGE",
    url: entryUrl.toString(),
    body: entryBody ?? `<html><script type="text/javascript">var phApp = phApp || ${JSON.stringify(config)}; phApp.ddo = {};</script></html>`,
    locator: exactOrganon ? organonBootstrapLocator(config) : "phenom-entry-config-v1|fixture",
    contentType: "text/html; charset=utf-8"
  }));

  let selectedFields: Record<string, string[]>;
  if (strategy.facetScope) {
    const scope = strategy.facetScope;
    const modernFacet = "exclusionFacet" in scope ? scope.exclusionFacet : undefined;
    const exclusionField = modernFacet?.field ?? "category";
    const excluded = modernFacet?.descriptors ?? scope.categoryExcludeDescriptors ?? [];
    const countryTotal = modernFacet ? 1 : excluded.length + 1;
    const globalTotal = excluded.length + 2;
    const globalExclusionValues = Object.fromEntries([
      ...excluded.map((descriptor) => [descriptor, 1] as const),
      ["Sales", 2]
    ]);
    const countryExclusionValues = Object.fromEntries([
      ...(!modernFacet ? excluded.map((descriptor) => [descriptor, 1] as const) : []),
      ["Sales", 1]
    ]);
    const fixtureJob = phenomJob({
      country: exactCountry,
      [exclusionField]: "Sales",
      ...jobOverrides
    });
    const globalBody = JSON.stringify({
      refineSearch: {
        totalHits: globalTotal,
        data: {
          jobs: [],
          aggregations: [
            { field: "country", value: {
              [strategy.facetScope.countryIncludeDescriptor]: countryTotal,
              "United States": globalTotal - countryTotal
            } },
            { field: exclusionField, value: globalExclusionValues }
          ]
        }
      }
    });
    const globalRequest = phenomRequestBody(config, Math.min(100, pageSize), 0, {});
    artifacts.push(artifact({
      logicalKey: "phenom-facet-global", kind: "ATS_API_RESPONSE", url: endpoint, body: globalBody,
      locator: requestLocator("facet-preflight:global", {
        family: "phenom", role: "facet-preflight-global", method: "POST", url: endpoint,
        body: globalRequest, coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: Math.min(100, pageSize) }
      })
    }));
    const countryBody = JSON.stringify({
      refineSearch: {
        totalHits: countryTotal,
        data: {
          jobs: [fixtureJob],
          aggregations: [
            { field: "country", value: { [strategy.facetScope.countryIncludeDescriptor]: countryTotal } },
            { field: exclusionField, value: countryExclusionValues }
          ]
        }
      }
    });
    const countrySelected = { country: [strategy.facetScope.countryIncludeDescriptor] };
    artifacts.push(artifact({
      logicalKey: "phenom-facet-country", kind: "ATS_API_RESPONSE", url: endpoint, body: countryBody,
      locator: requestLocator("facet-preflight:country", {
        family: "phenom", role: "facet-preflight-country", method: "POST", url: endpoint,
        body: phenomRequestBody(config, Math.min(100, pageSize), 0, countrySelected),
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: Math.min(100, pageSize) }
      })
    }));
    selectedFields = excluded.length > 0
      ? { ...countrySelected, [exclusionField]: ["Sales"] }
      : countrySelected;
  } else {
    selectedFields = { country: [strategy.countryFilter ?? "China"] };
  }

  const fixtureJob = phenomJob({
    country: exactCountry,
    ...(exactUcb ? { reqId: "1", postedDate: "2026-07-14T05:54:14.000+0000" } : {}),
    ...(strategy.facetScope
      ? { ["exclusionFacet" in strategy.facetScope
        ? strategy.facetScope.exclusionFacet.field
        : "category"]: "Sales" }
      : {}),
    ...jobOverrides
  });

  if (exactOrganon) Object.assign(fixtureJob, organonRow(1,"Shanghai",jobOverrides));

  const pageBody = JSON.stringify({
    refineSearch: {
      totalHits: 1,
      ...(exactRoche ? {} : { from: 0 }),
      data: { jobs: [fixtureJob], aggregations: [] }
    }
  });
  const pageLocator = requestLocator(exactOrganon ? ["phenom-page-v1","entry:phenom-entry-0000",
    `config:${irreversibleOfficialJsonEvidenceId(organonBootstrapLocator(config))}`,
    `selectedFields:${irreversibleOfficialJsonEvidenceId(JSON.stringify({country:["China"]}))}`,
    "requestOffset:0","json:$.refineSearch.totalHits"].join("|") : "json:$.refineSearch.totalHits", {
    family: "phenom", role: "page", method: "POST", url: endpoint,
    body: phenomRequestBody(config, pageSize, 0, selectedFields),
    coordinate: { sequence: 0, requestedOffset: 0, requestedPage: null, requestedPageSize: pageSize }
  });
  artifacts.push(artifact({
    logicalKey: "phenom-page-0000", kind: "PAGINATION_PAGE", url: endpoint,
    body: pageBody, locator: pageLocator
  }));
  const raw = {
    captureTool: { name: "strict-dynamic-total-test", version: "1" },
    artifacts,
    pages: [{
      sequence: 0,
      artifactLogicalKey: "phenom-page-0000",
      requestedOffset: 0,
      returnedOffset: exactRoche ? null : 0,
      requestedPage: null,
      returnedPage: null,
      requestedPageSize: pageSize,
      returnedPageSize: null,
      rawJobIds: exactOrganon ? [irreversibleOfficialJsonEvidenceId("MECEUSR700001ZHCN")] : exactRoche || exactUcb ? [irreversibleOfficialJsonEvidenceId("1")] : ["raw-1"],
      validJobIds: exactOrganon ? [irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId("MECEUSR700001ZHCN"))] : exactRoche || exactUcb
        ? [irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId("1"))]
        : ["valid-1"],
      declaredTotal: 1,
      declaredCount: null,
      declaredPages: 1,
      nextPageSignalBefore: null,
      nextPageSignalAfter: null,
      responseFingerprintSha256: createHash("sha256").update(pageBody).digest("hex"),
      termination: "NEXT_ABSENT" as const,
      anomalyCodes: [],
      capturedAt: CAPTURED_AT
    }],
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT" as const,
      value: 1,
      artifactLogicalKey: "phenom-page-0000",
      extractorLocator: pageLocator,
      scope: "SOURCE" as const
    },
    fetchCounts: {
      rawCount: 1, parsedCount: 1, validCount: 1,
      parseDiscardCount: 0, validationDiscardCount: 0
    },
    fetchLosses: []
  };
  const evidence = deriveCanonicalPaginationEvidence({ evidence: raw, expectedChannelIds: [], filteredOutput: true });
  return { evidence, evaluation: evaluatePaginationEvidence({ evidence, expectedChannelIds: [], filteredOutput: true }) };
}

async function crawlWith(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  evaluation: PaginationEvaluation,
  payload?: unknown
) {
  const ucbRaw = plan.source.id === "source-ucb-china-social" ? JSON.parse(
    evidence.artifacts.find(artifact => artifact.logicalKey === "phenom-page-0000")!.body as string
  ).refineSearch.data.jobs[0] : undefined;
  const ucbPayload = ucbRaw ? { jobs: [{
    sourceJobId: persistentOfficialJsonJobId(ucbRaw.jobId), title: ucbRaw.title,
    officialUrl: `https://careers.ucb.com/global/en/job/${ucbRaw.reqId}`,
    locationRaw: ucbRaw.location, cities: [ucbRaw.city === "Shanghai" ? "上海" : ucbRaw.city],
    officialPublishedAt: "2026-07-14T05:54:14.000Z"
  }] } : undefined;
  const organonRaw = plan.source.id === "source-organon-china-social" ? JSON.parse(evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!.body as string).refineSearch.data.jobs[0] : undefined;
  const organonPayload = organonRaw ? {jobs:[{sourceJobId:persistentOfficialJsonJobId(organonRaw.jobSeqNo),title:organonRaw.title,
    officialUrl:organonRaw.applyUrl,locationRaw:organonRaw.location,cities:[organonRaw.city==="Shanghai"?"上海":organonRaw.city],officialPublishedAt:"2026-09-24T00:00:00.000Z"}]}:undefined;
  const effectivePayload = payload ?? organonPayload ?? ucbPayload ?? payloadFor(plan, plan.source.id === "source-roche-china-social"
    ? [persistentOfficialJsonJobId("1")]
    : ["job-1"]);
  return runSourceCrawl(plan, { fetch: async () => ({
    ok: true,
    capturedAt: CAPTURED_AT,
    payload: effectivePayload,
    fetchEvidence: evidence,
    paginationEvaluation: evaluation,
    completeness: {
      completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      ...(evidence.declaredCompleteness
        ? { expectedJobCount: evidence.declaredCompleteness.value }
        : {}),
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: plan.source.officialEntryUrl
    }
  }) });
}

function replaceArtifactBody(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string,
  mutate: (body: Record<string, unknown>) => void
): PersistentSourceFetchEvidence {
  return {
    ...evidence,
    artifacts: evidence.artifacts.map((candidate) => {
      if (candidate.logicalKey !== logicalKey) return candidate;
      const parsed = JSON.parse(candidate.body as string) as Record<string, unknown>;
      mutate(parsed);
      return { ...candidate, body: JSON.stringify(parsed) };
    })
  };
}

describe("strict dynamic official-total replay", () => {
  it.each(WORKDAY_SOURCES)("does not qualify %s from a China facet without matching raw geography and identity", async (sourceId) => {
    const plan = planFor(sourceId);
    const { evidence, evaluation } = dynamicWorkdayEvidence(plan);

    const result = await crawlWith(plan, evidence, evaluation);

    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: false },
      observation: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [], collisionGroups: [] }
    });
  });

  it("rejects Workday official-total body drift and a changed request contract", async () => {
    const plan = planFor("source-biogen-china-social");
    const { evidence, evaluation } = dynamicWorkdayEvidence(plan);
    const bodyDrift = replaceArtifactBody(evidence, "workday-page-0000", (body) => { body.total = 2; });
    const locatorDrift = {
      ...evidence,
      artifacts: evidence.artifacts.map((candidate) => candidate.logicalKey === "workday-page-0000"
        ? { ...candidate, extractorLocator: `${candidate.extractorLocator.slice(0, -1)}0` }
        : candidate)
    };

    expect((await crawlWith(plan, bodyDrift, evaluation)).truth.completenessVerified).toBe(false);
    expect((await crawlWith(plan, locatorDrift, evaluation)).truth.completenessVerified).toBe(false);
  });

  it.each(PHENOM_SOURCES)("verifies %s from a live-shaped static JavaScript phApp config", async (sourceId) => {
    const plan = planFor(sourceId);
    const { evidence, evaluation } = phenomEvidence(plan);

    expect((await crawlWith(plan, evidence, evaluation))).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [], collisionGroups: [] }
    });
  });

  it.each(GENERIC_LOCATION_PHENOM_SOURCES.flatMap((sourceId) =>
    GENERIC_LOCATION_VALUES.map((location) => [sourceId, location] as const)
  ))("rejects coherent strict replay for exact staged %s with generic location %s", async (sourceId, location) => {
    const plan = planFor(sourceId);
    const { evidence, evaluation } = phenomEvidence(plan, undefined, {
      city: location,
      location
    });

    const result = await crawlWith(plan, evidence, evaluation);

    expect(result.truth.completenessVerified).toBe(false);
    expect(result.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it.each(GENERIC_LOCATION_PHENOM_SOURCES.flatMap((sourceId) =>
    ["Wuxi", "Shenyang", "Qingdao"].map((city) => [sourceId, city] as const)
  ))("applies source-local city review in coherent replay for %s with city %s", async (sourceId, city) => {
    const plan = planFor(sourceId);
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "phenom") {
      throw new Error("Phenom plan expected");
    }
    const country = plan.officialJsonFetch.facetScope?.countryIncludeDescriptor ??
      plan.officialJsonFetch.countryFilter ?? "China";
    const { evidence, evaluation } = phenomEvidence(plan, undefined, {
      city,
      location: `${city}, ${country}`
    });

    const result=await crawlWith(plan,evidence,evaluation);
    if(sourceId==="source-ucb-china-social" || sourceId==="source-organon-china-social") {
      expect(result.truth.completenessVerified).toBe(false);
      expect(result.observation.completenessStatus).not.toBe("VERIFIED");
      return;
    }
    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1 }
    });
  });

  it.each([
    ["dynamic spread", (config: Record<string, unknown>) =>
      `<script>const base = {}; const phApp = {...base, ${JSON.stringify(config).slice(1, -1)}};</script>`],
    ["nested declaration", (config: Record<string, unknown>) =>
      `<script>function bootstrap(){ const phApp = ${JSON.stringify(config)}; return phApp; }</script>`],
    ["pageId mutation", (config: Record<string, unknown>) =>
      `<script>const phApp = ${JSON.stringify(config)}; phApp.pageId = makePageId();</script>`],
    ["conflicting configs", (config: Record<string, unknown>) =>
      `<script>const phApp = ${JSON.stringify(config)};</script><script>window.phApp = ${JSON.stringify({ ...config, pageId: "other" })};</script>`]
  ])("rejects a Phenom %s", async (_label, entry) => {
    const plan = planFor("source-organon-china-social");
    const { evidence, evaluation } = phenomEvidence(plan, entry(phenomConfig(plan)));

    expect((await crawlWith(plan, evidence, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("rejects Phenom official-total page-scope tampering", async () => {
    const plan = planFor("source-ucb-china-social");
    const { evidence, evaluation } = phenomEvidence(plan);
    const pageDrift = replaceArtifactBody(evidence, "phenom-page-0000", (body) => {
      const refine = body.refineSearch as Record<string, unknown>;
      refine.totalHits = 2;
    });
    expect((await crawlWith(plan, pageDrift, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("verifies Novo Nordisk only when the exact China Mainland response closes its official total", async () => {
    const plan = planFor("source-novo-nordisk-china-social");
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") {
      throw new Error("Novo plan expected");
    }
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: createNovoSingleJobHttp(CAPTURED_AT)
    });

    const result = await runSourceCrawl(plan, { fetch: fetcher });

    expect(result).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [], collisionGroups: [] },
      fetchEvidence: { pages: [{ termination: "NEXT_ABSENT" }] }
    });
  });

  it("rejects Novo official-total body and loss-ledger tampering", async () => {
    const plan = planFor("source-novo-nordisk-china-social");
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "novo-nordisk") {
      throw new Error("Novo plan expected");
    }
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: createNovoSingleJobHttp(CAPTURED_AT)
    });
    const captured = await fetcher(plan) as SourceFetchResult;
    if (!captured.ok || !("payload" in captured) ||
      !captured.fetchEvidence || !captured.paginationEvaluation) {
      throw new Error("Novo evidence expected");
    }
    const bodyDrift = replaceArtifactBody(captured.fetchEvidence, "official-json-page-0000", (body) => {
      const data = body.data as Record<string, unknown>;
      data.totalMatches = 2;
    });
    const lostFetcher = createOfficialJsonSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: createNovoSingleJobHttp(CAPTURED_AT, {invalidTitle: true})
    });

    expect((await crawlWith(plan, bodyDrift, captured.paginationEvaluation, captured.payload))
      .truth.completenessVerified).toBe(false);
    expect((await runSourceCrawl(plan, { fetch: lostFetcher })).truth.completenessVerified).toBe(false);
  });
});
