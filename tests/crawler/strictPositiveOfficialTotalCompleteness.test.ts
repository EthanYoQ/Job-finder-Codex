import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  expectedChannelSetHash,
  sourcePlanConfigSha256,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import {
  deriveCanonicalPaginationEvidence,
  evaluatePaginationEvidence,
  type PaginationEvaluation
} from "../../src/crawler/paginationEvidence";
import {
  sha256Bytes,
  type PersistentSourceFetchEvidence
} from "../../src/crawler/sourceFetchEvidence";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";

const CAPTURED_AT = "2026-07-14T14:30:00.000Z";
const SANDOZ_JSONAPI_FIELDS = [
  "title", "field_job_title", "field_job_employment_type", "field_job_type", "field_job_id",
  "field_job_business_unit", "field_job_work_location", "field_job_posted_date", "path",
  "drupal_internal__tid", "field_date", "field_job_country", "field_job_alt_country_1",
  "field_job_alt_country_2", "field_job_alt_country_3"
].join(",");
const MOKA_AES_IV = "de7c21ed8d6f50fe";
const MOKA_AES_KEY = "6e9ecb8e9c6c1a5e";
const PLANS = buildStagedSourceCrawlPlans(candidateCompanies);
const AUDITED_POSITIVE_TOTAL_SOURCES = [
  "source-amgen-china-social",
  "source-biogen-china-social",
  "source-bms-china-social",
  "source-pfizer-china-social",
  "source-hengrui-social",
  "source-jimin-kexin-social",
  "source-lilly-china-social",
  "source-organon-china-social",
  "source-ucb-china-social",
  "source-cttq-social",
  "source-tianjin-pharma-social",
  "source-united-lab-social",
  "source-yangzijiang-social",
  "source-lunan-social"
] as const;
const STRICT_URL_STRATEGY_SOURCES = [
  "source-pfizer-china-social",
  "source-hengrui-social",
  "source-lilly-china-social",
  "source-cttq-social",
  "source-lunan-social",
  "source-sandoz-china-social"
] as const;

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = PLANS.find((candidate) => candidate.source.id === sourceId);
  if (!plan) throw new Error(`Missing source plan: ${sourceId}`);
  return plan;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
}

function setAdapterPath(
  target: Record<string, unknown>,
  path: string | readonly string[],
  value: unknown
): void {
  for (const candidate of typeof path === "string" ? [path] : path) {
    setPath(target, candidate, value);
  }
}

function payloadFor(plan: SourceCrawlPlan, ids: readonly string[]): unknown {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  const rows = ids.map((id) => {
    const row: Record<string, unknown> = {};
    const values: Record<string, unknown> = {
      sourceJobId: id,
      officialTitle: `Official role ${id}`,
      officialUrl: new URL(`/jobs/${id}`, plan.source.officialEntryUrl).toString(),
      locationRaw: "上海",
      cities: ["上海"],
      category: "其他",
      officialPublishedAt: "2026-07-14"
    };
    for (const [field, path] of Object.entries(plan.json.fields)) {
      if (path && field in values) setAdapterPath(row, path, values[field]);
    }
    return row;
  });
  const payload: Record<string, unknown> = {};
  if (!plan.json.jobsPath) throw new Error("Expected jobs path");
  setAdapterPath(payload, plan.json.jobsPath, rows);
  return payload;
}

function declaredArtifactUrl(plan: SourceCrawlPlan): string {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  const entry = new URL(plan.source.officialEntryUrl);
  if (plan.workday) {
    return new URL(`/wday/cxs/${plan.workday.tenant}/${plan.workday.site}/jobs`, entry.origin).toString();
  }
  if (plan.moka) return "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") return new URL("/widgets", entry.origin).toString();
  if (strategy?.kind === "beisen-zhiye-2022") {
    return new URL("/api/Jobad/GetJobAdPageList", entry.origin).toString();
  }
  if (strategy?.kind === "hcm-cloud") {
    return new URL("/api/hcm.model.count?model=ReleaseJobMgr", entry.origin).toString();
  }
  if (strategy?.kind === "sandoz-jsonapi") return sandozProbeUrl(plan, "primary", 0);
  throw new Error(`No strict declared-artifact URL fixture for ${plan.source.id}`);
}

function sandozProbeUrl(
  plan: SourceCrawlPlan,
  probe: "primary" | "alt1" | "alt2" | "alt3",
  page: number
): string {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "sandoz-jsonapi") {
    throw new Error("Expected Sandoz plan");
  }
  const strategy = plan.officialJsonFetch;
  const url = new URL(strategy.endpointUrl);
  url.searchParams.set("fields[node--jobs]", SANDOZ_JSONAPI_FIELDS);
  url.searchParams.set("page", String(page));
  url.searchParams.set("views-filter[field_job_functional_area]", "All");
  url.searchParams.set("views-filter[field_job_posted_date][min]", "");
  url.searchParams.set("views-filter[field_job_posted_date][max]", "");
  if (probe === "primary") {
    url.searchParams.set("views-filter[field_job_country]", String(strategy.countryTermTargetId));
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
  } else if (probe === "alt1") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", String(strategy.countryTermTargetId));
  } else if (probe === "alt2") {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_2]", String(strategy.countryTermTargetId));
  } else {
    url.searchParams.set("views-filter[field_job_country]", "All");
    url.searchParams.set("views-filter[field_job_alt_country_1]", "");
    url.searchParams.set("views-filter[field_job_alt_country_3]", String(strategy.countryTermTargetId));
  }
  return url.toString();
}

function pageArtifactUrl(plan: SourceCrawlPlan, index: number): string {
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "hcm-cloud") {
    return new URL("/api/hcm.model.list?model=ReleaseJobMgr", plan.source.officialEntryUrl).toString();
  }
  return plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "sandoz-jsonapi"
    ? sandozProbeUrl(plan, "primary", index)
    : declaredArtifactUrl(plan);
}

function pageArtifact(logicalKey: string, body: string, url: string, extractorLocator = "json:total") {
  return {
    id: logicalKey,
    logicalKey,
    kind: "PAGINATION_PAGE" as const,
    requestedUrl: url,
    finalUrl: url,
    httpStatus: 200,
    contentType: "application/json",
    capturedAt: CAPTURED_AT,
    body,
    bodyRepresentation: "EXACT" as const,
    extractorLocator
  };
}

function fixtureMokaEncryptedBody(payload: unknown): string {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(MOKA_AES_KEY), Buffer.from(MOKA_AES_IV));
  let data = cipher.update(JSON.stringify(payload), "utf8", "base64");
  data += cipher.final("base64");
  return JSON.stringify({ data, necromancer: MOKA_AES_KEY });
}

function fixtureMokaEntryArtifact(plan: SourceCrawlPlan): FixtureArtifact {
  if (plan.adapterId !== "official-json" || !plan.moka) throw new Error("Expected Moka plan");
  const value = JSON.stringify({
    aesIv: MOKA_AES_IV,
    mode: plan.moka.expectedMode,
    siteId: plan.moka.expectedSiteId,
    org: { id: plan.moka.expectedOrgId, siteId: plan.moka.expectedSiteId }
  }).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return {
    id: "moka-entry-0000",
    logicalKey: "moka-entry-0000",
    kind: "OFFICIAL_COMPANY_PAGE",
    requestedUrl: plan.source.officialEntryUrl,
    finalUrl: plan.moka.campaignUrl,
    httpStatus: 200,
    contentType: "text/html; charset=utf-8",
    capturedAt: CAPTURED_AT,
    body: `<input id="init-data" value="${value}">`,
    bodyRepresentation: "EXACT",
    extractorLocator: "html:#init-data[value]"
  };
}

function fixtureSandozScopeArtifacts(plan: SourceCrawlPlan): FixtureArtifact[] {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "sandoz-jsonapi") {
    throw new Error("Expected Sandoz plan");
  }
  const config = plan.officialJsonFetch;
  const taxonomyUrl = new URL(config.taxonomyEndpointUrl);
  taxonomyUrl.searchParams.set("filter[drupal_internal__tid]", String(config.countryTermTargetId));
  const taxonomy = {
    ...pageArtifact("sandoz-taxonomy", JSON.stringify({ data: [{
      type: "taxonomy_term--job_location",
      id: config.countryTermUuid,
      attributes: { drupal_internal__tid: config.countryTermTargetId, name: config.countryTermName }
    }] }), taxonomyUrl.toString(), `sandoz-taxonomy-v1|target:${config.countryTermTargetId}|json:` +
      "$.data[0].type,$.data[0].id,$.data[0].attributes.drupal_internal__tid,$.data[0].attributes.name"),
    kind: "ATS_API_RESPONSE" as const,
    contentType: "application/vnd.api+json"
  };
  const alternates = (["alt1", "alt2", "alt3"] as const).map((probe) => {
    const url = sandozProbeUrl(plan, probe, 0);
    return {
      ...pageArtifact(`sandoz-${probe}-zero`, JSON.stringify({
        data: [],
        meta: { count: 0 },
        number_of_items_per_page: config.pageSize,
        links: { self: { href: url } }
      }), url, `sandoz-jsonapi-v2|probe:${probe}|page:0|page-size:${config.pageSize}` +
        "|fields:node--jobs-v1|json:$.data[*],$.meta.count,$.number_of_items_per_page," +
        "$.links.self.href,$.links.next.href"),
      kind: "ATS_API_RESPONSE" as const,
      contentType: "application/vnd.api+json"
    };
  });
  return [taxonomy, ...alternates];
}

type FixtureContract = {
  family: "workday" | "moka" | "phenom" | "beisen" | "hcm";
  role: string;
  method: "POST";
  url: string;
  body: unknown;
  coordinate: unknown;
};
type FixtureArtifact = PersistentSourceFetchEvidence["artifacts"][number];

const BEISEN_DISPLAY_FIELDS = [
  "Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode"
] as const;

function fixtureCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fixtureCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
      .map(([key, child]) => [key, fixtureCanonicalValue(child)]));
  }
  return value;
}

function fixtureRequestLocator(base: string, contract: FixtureContract): string {
  const canonical = fixtureCanonicalValue({ v: 2, ...contract });
  const digest = createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  return `${base}|request-contract-v2|sha256:${digest}`;
}

function fixturePageSize(plan: SourceCrawlPlan): number {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  if (plan.workday) {
    return !plan.workday.pageSize || !Number.isFinite(plan.workday.pageSize)
      ? 20 : Math.min(20, Math.max(1, Math.floor(plan.workday.pageSize)));
  }
  if (plan.moka) return 50;
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") return Math.max(1, Math.min(100, strategy.pageSize ?? 50));
  if (strategy?.kind === "beisen-zhiye-2022") return Math.max(1, Math.min(100, strategy.pageSize ?? 100));
  if (strategy?.kind === "hcm-cloud") return Math.max(1, strategy.pageSize ?? 20);
  if (strategy?.kind === "sandoz-jsonapi") return strategy.pageSize ?? 10;
  throw new Error(`No strict page-size fixture for ${plan.source.id}`);
}

function fixturePhenomConfig(plan: SourceCrawlPlan) {
  return {
    widgetApiEndpoint: new URL("/widgets", plan.source.officialEntryUrl).toString(),
    refNum: "fixture-ref",
    locale: "en_global",
    deviceType: "desktop",
    country: "cn",
    pageName: "search-results",
    pageId: "fixture-page"
  };
}

function fixturePhenomEntryUrl(plan: SourceCrawlPlan): string {
  const url = new URL(plan.source.officialEntryUrl);
  for (const key of [...url.searchParams.keys()]) {
    if (["keyword", "keywords"].includes(key.normalize("NFKC").toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

function fixturePhenomRequestBody(
  config: ReturnType<typeof fixturePhenomConfig>,
  size: number,
  from: number,
  countryFilter: string
): Record<string, unknown> {
  return {
    lang: config.locale, locale: config.locale, deviceType: config.deviceType, country: config.country,
    pageName: config.pageName, size, from, jobs: true, counts: true,
    all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
    clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: config.pageId,
    siteType: "external", keywords: "", global: true, selected_fields: { country: [countryFilter] },
    sort: { order: "desc", field: "postedDate" }, locationData: {}, refNum: config.refNum, ddoKey: "refineSearch"
  };
}

function fixtureHcmListBody(plan: SourceCrawlPlan, page: number, pageSize: number): Record<string, unknown> {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "hcm-cloud") {
    throw new Error("Expected HCM plan");
  }
  const config = plan.officialJsonFetch;
  return {
    model: "ReleaseJobMgr", filter_str: null,
    filter_dict: { job_class: config.jobClass ?? "社会招聘", status: "1", delivery: 1, contract_unit: null },
    page_index: page, page_size: pageSize,
    extra_property: {
      state: config.portalState ?? "portal_social",
      sorts: [{ type: "desc", key: "is_top" }, { key: "release_date", type: "desc" }, { type: "desc", key: "id" }],
      filter_params: { job_class: config.recruitType ?? "social", filter_dict: { select_depart: null },
        page_index: page, page_size: pageSize, filter_str: null, show_fields_key: [] },
      only_list: true
    },
    biz_type: "list"
  };
}

function fixtureHcmCountBody(plan: SourceCrawlPlan): Record<string, unknown> {
  const list = fixtureHcmListBody(plan, 1, 20);
  const extra = { ...(list.extra_property as Record<string, unknown>) };
  delete extra.only_list;
  return { ...list, page_index: null, page_size: null, extra_property: extra,
    count_by: ["id"], sum_by: [], group_by: null, avg_by: [], min_by: [], max_by: [] };
}

function fixtureWorkdayScope(plan: SourceCrawlPlan, total: number): {
  appliedFacets: Record<string, readonly string[]>;
  artifacts: FixtureArtifact[];
  hasDescriptorPolicy: boolean;
} {
  if (plan.adapterId !== "official-json" || !plan.workday) throw new Error("Expected Workday plan");
  const config = plan.workday;
  const appliedFacets: Record<string, readonly string[]> = { ...(config.appliedFacets ?? {}) };
  const artifacts: FixtureArtifact[] = [];
  if (config.locationFacetPolicy?.kind === "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT") {
    const pageSize = fixturePageSize(plan);
    const url = declaredArtifactUrl(plan);
    const requestBody = { appliedFacets: { ...appliedFacets }, limit: pageSize, offset: 0 };
    const selectedLocationId = "workday-pfizer-mainland-location";
    const body = JSON.stringify({
      total: total + 1,
      jobPostings: [],
      facets: [{
        facetParameter: "locationMainGroup",
        values: [{
          facetParameter: "locations",
          descriptor: "All Locations",
          values: [
            { descriptor: "China - Shanghai - Shanghai", id: selectedLocationId, count: total },
            { descriptor: "APAC - Remote", id: "workday-pfizer-apac-remote", count: 0 }
          ]
        }]
      }]
    });
    artifacts.push({
      ...pageArtifact("workday-preflight-0000", body, url, fixtureRequestLocator("$.facets", {
        family: "workday", role: "location-preflight", method: "POST", url, body: requestBody,
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
      })),
      kind: "ATS_API_RESPONSE" as const
    });
    appliedFacets[config.locationFacetPolicy.facetParameter] = [selectedLocationId];
  }
  const boundary = config.facetDescriptorBoundary;
  const exclusions = config.facetDescriptorExclusions ?? [];
  const hasDescriptorPolicy = Boolean(boundary) || exclusions.length > 0;
  if (!hasDescriptorPolicy) return { appliedFacets, artifacts, hasDescriptorPolicy };

  const parameter = boundary?.facetParameter ?? exclusions[0]!.facetParameter;
  const allowedDescriptors = boundary?.allowedDescriptors ?? ["Fixture allowed"];
  const excludedDescriptors = boundary?.excludedDescriptors ?? exclusions[0]?.excludedDescriptors ?? [];
  const values = [
    ...allowedDescriptors.map((descriptor, index) => ({
      descriptor,
      id: `workday-allowed-${index}`,
      count: index === 0 ? total : 0
    })),
    ...excludedDescriptors.map((descriptor, index) => ({
      descriptor,
      id: `workday-excluded-${index}`,
      count: 0
    }))
  ];
  const facetPreflightAppliedFacets = { ...appliedFacets };
  appliedFacets[parameter] = boundary
    ? values.filter((value) => allowedDescriptors.includes(value.descriptor)).map((value) => value.id)
    : values.filter((value) => !excludedDescriptors.includes(value.descriptor)).map((value) => value.id);

  const pageSize = fixturePageSize(plan);
  const url = declaredArtifactUrl(plan);
  const requestBody = { appliedFacets: facetPreflightAppliedFacets, limit: pageSize, offset: 0 };
  const body = JSON.stringify({ total, jobPostings: [], facets: [{ facetParameter: parameter, values }] });
  return {
    appliedFacets,
    hasDescriptorPolicy,
    artifacts: [...artifacts, {
      ...pageArtifact("workday-facet-preflight-0000", body, url, fixtureRequestLocator("$.facets", {
        family: "workday", role: "facet-preflight", method: "POST", url, body: requestBody,
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: pageSize }
      })),
      kind: "ATS_API_RESPONSE" as const
    }]
  };
}

function fixturePageContract(
  plan: SourceCrawlPlan,
  sequence: number,
  workdayScope: ReturnType<typeof fixtureWorkdayScope> | undefined
): FixtureContract | undefined {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  const pageSize = fixturePageSize(plan);
  const url = pageArtifactUrl(plan, sequence);
  if (plan.workday) {
    const hasDescriptorPolicy = workdayScope?.hasDescriptorPolicy ?? false;
    return {
      family: "workday", role: "page", method: "POST", url,
      body: { appliedFacets: workdayScope?.appliedFacets ?? { ...(plan.workday.appliedFacets ?? {}) },
        ...(plan.workday.searchText && !hasDescriptorPolicy ? { searchText: plan.workday.searchText } : {}),
        limit: pageSize, offset: sequence * pageSize },
      coordinate: { sequence, requestedOffset: sequence * pageSize, requestedPage: sequence,
        requestedPageSize: pageSize }
    };
  }
  if (plan.moka) {
    return {
      family: "moka", role: "page", method: "POST", url,
      body: { orgId: plan.moka.expectedOrgId, siteId: plan.moka.expectedSiteId, limit: 50,
        offset: sequence * 50, needStat: true, isCampusJob: false, site: plan.moka.expectedMode, locale: "zh-CN" },
      coordinate: { sequence, requestedOffset: sequence * 50, requestedPage: null, requestedPageSize: 50 }
    };
  }
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") {
    const config = fixturePhenomConfig(plan);
    return {
      family: "phenom", role: "page", method: "POST", url,
      body: fixturePhenomRequestBody(config, pageSize, sequence * pageSize, strategy.countryFilter ?? "China"),
      coordinate: { sequence, requestedOffset: sequence * pageSize, requestedPage: null,
        requestedPageSize: pageSize }
    };
  }
  if (strategy?.kind === "beisen-zhiye-2022") {
    return {
      family: "beisen", role: "page", method: "POST", url,
      body: { PageIndex: sequence, PageSize: pageSize, Category: [strategy.category ?? "1"], KeyWords: "",
        SpecialType: 0, PortalId: "", DisplayFields: strategy.displayFields ?? [...BEISEN_DISPLAY_FIELDS] },
      coordinate: { sequence, requestedPage: sequence, requestedPageSize: pageSize }
    };
  }
  if (strategy?.kind === "hcm-cloud") {
    return {
      family: "hcm", role: "page", method: "POST", url,
      body: fixtureHcmListBody(plan, sequence + 1, pageSize),
      coordinate: { sequence, requestedPage: sequence + 1, requestedPageSize: pageSize }
    };
  }
  return undefined;
}

function fixturePageCoordinates(plan: SourceCrawlPlan, sequence: number, missingReturnedPage: boolean) {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  const pageSize = fixturePageSize(plan);
  if (plan.workday) return { requestedOffset: sequence * pageSize, returnedOffset: sequence * pageSize,
    requestedPage: sequence, returnedPage: missingReturnedPage ? null : sequence,
    requestedPageSize: pageSize, returnedPageSize: null };
  if (plan.moka || plan.officialJsonFetch?.kind === "phenom") {
    return { requestedOffset: sequence * pageSize, returnedOffset: sequence * pageSize,
      requestedPage: null, returnedPage: null, requestedPageSize: pageSize, returnedPageSize: null };
  }
  if (plan.officialJsonFetch?.kind === "hcm-cloud") {
    return { requestedOffset: null, returnedOffset: null, requestedPage: sequence + 1,
      returnedPage: missingReturnedPage ? null : sequence + 1,
      requestedPageSize: pageSize, returnedPageSize: null };
  }
  return { requestedOffset: null, returnedOffset: null, requestedPage: sequence,
    returnedPage: missingReturnedPage ? null : sequence, requestedPageSize: pageSize,
    returnedPageSize: plan.officialJsonFetch?.kind === "sandoz-jsonapi" ? pageSize : null };
}

function fixtureExpectedToFailClosed(plan: SourceCrawlPlan): boolean {
  if (plan.adapterId !== "official-json") return false;
  if (plan.workday) {
    const hasStaticLocationFacet = Object.keys(plan.workday.appliedFacets ?? {}).some(
      (facetParameter) => /location|country|countries/iu.test(facetParameter)
    );
    const unsupportedLocationPolicy = plan.workday.locationFacetPolicy !== undefined &&
      plan.workday.locationFacetPolicy.kind !== "PFIZER_AUDITED_COUNTRY_LOCATION_REFINEMENT";
    return unsupportedLocationPolicy || Boolean(plan.workday.searchText && !hasStaticLocationFacet);
  }
  return plan.officialJsonFetch?.kind === "phenom" && Boolean(plan.officialJsonFetch.facetScope);
}

function positiveCountEvidence(plan: SourceCrawlPlan, options: {
  ids?: readonly string[];
  missingReturnedPage?: boolean;
  laterZero?: boolean;
  channelIds?: readonly (string | undefined)[];
} = {}): { evidence: PersistentSourceFetchEvidence; evaluation: PaginationEvaluation } {
  const ids = options.ids ?? ["job-1"];
  const pageSize = fixturePageSize(plan);
  if (options.laterZero && ids.length !== pageSize + 1) {
    throw new Error("later-zero fixture requires one full page plus one job");
  }
  const splitChannelScopes = new Set(
    (options.channelIds ?? []).map((channelId) => channelId ?? "__SOURCE__")
  ).size > 1;
  const groups = splitChannelScopes
    ? ids.map((id) => [id])
    : Array.from({ length: Math.ceil(ids.length / pageSize) }, (_, index) =>
        ids.slice(index * pageSize, (index + 1) * pageSize));
  const bodies = groups.map((group, index) => {
    const total = options.laterZero && index > 0 ? 0 : ids.length;
    if (plan.adapterId === "official-json" && plan.moka) {
      return fixtureMokaEncryptedBody({
        success: true,
        data: {
          offset: index * pageSize,
          jobStats: { total },
          jobs: group.map((id) => ({ id, title: `Official role ${id}`,
            locations: [{ cityName: "上海", country: "中国" }] }))
        }
      });
    }
    if (plan.adapterId === "official-json" && plan.workday) {
      return JSON.stringify({ total, jobPostings: group.map((id) => ({
        title: `Official role ${id}`, externalPath: `/job/China/${id}`,
        locationsText: "Shanghai, China", bulletFields: [id]
      })) });
    }
    if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "phenom") {
      return JSON.stringify({ refineSearch: { totalHits: total, data: {
        jobs: group.map((id) => ({ jobId: id, title: `Official role ${id}`, country: "China" })),
        aggregations: []
      } } });
    }
    return JSON.stringify({ total, ids: group });
  });
  const workdayScope = plan.adapterId === "official-json" && plan.workday
    ? fixtureWorkdayScope(plan, ids.length)
    : undefined;
  const pageArtifacts = bodies.map((body, index) => {
    const baseLocator = "json:total";
    const contract = fixturePageContract(plan, index, workdayScope);
    const locator = contract ? fixtureRequestLocator(baseLocator, contract) : baseLocator;
    return {
      ...pageArtifact(`page-${index + 1}`, body, pageArtifactUrl(plan, index), locator),
      ...(options.channelIds?.[index] ? { channelId: options.channelIds[index] } : {})
    };
  });
  const supportingArtifacts: FixtureArtifact[] = [...(workdayScope?.artifacts ?? [])];
  if (plan.adapterId === "official-json" && plan.moka) {
    supportingArtifacts.push(fixtureMokaEntryArtifact(plan));
  }
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "sandoz-jsonapi") {
    supportingArtifacts.push(...fixtureSandozScopeArtifacts(plan));
  }
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "phenom") {
    const config = fixturePhenomConfig(plan);
    supportingArtifacts.push({
      ...pageArtifact(
        "phenom-entry-0000",
        `<script type="application/json">${JSON.stringify({ phApp: config })}</script>`,
        fixturePhenomEntryUrl(plan),
        "phenom-entry:test"
      ),
      kind: "OFFICIAL_COMPANY_PAGE" as const,
      contentType: "text/html"
    });
  }
  let declarationArtifactLogicalKey = "page-1";
  let declarationLocator = pageArtifacts[0]!.extractorLocator;
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "hcm-cloud") {
    const url = declaredArtifactUrl(plan);
    declarationArtifactLogicalKey = "hcm-count-0000";
    declarationLocator = fixtureRequestLocator("json:count", {
      family: "hcm", role: "count", method: "POST", url, body: fixtureHcmCountBody(plan),
      coordinate: { sequence: null, requestedPage: null, requestedPageSize: null }
    });
    supportingArtifacts.push({
      ...pageArtifact(declarationArtifactLogicalKey, JSON.stringify({ count: ids.length }), url, declarationLocator),
      kind: "ATS_API_RESPONSE" as const
    });
  }
  const rawEvidence = {
    captureTool: { name: "strict-total-test", version: "1" },
    artifacts: [...supportingArtifacts, ...pageArtifacts],
    pages: groups.map((group, index) => ({
      sequence: index,
      artifactLogicalKey: `page-${index + 1}`,
      ...fixturePageCoordinates(plan, index, options.missingReturnedPage === true),
      rawJobIds: group,
      validJobIds: group,
      declaredTotal: options.laterZero && index > 0 ? 0 : ids.length,
      declaredCount: null,
      declaredPages: null,
      nextPageSignalBefore: splitChannelScopes ? null : index === 0 ? null : String(index),
      nextPageSignalAfter: splitChannelScopes ? null : index < groups.length - 1 ? String(index + 1) : null,
      responseFingerprintSha256: createHash("sha256").update(bodies[index]!).digest("hex"),
      termination: splitChannelScopes
        ? "NEXT_ABSENT" as const
        : index === groups.length - 1
          ? options.laterZero ? "NEXT_ABSENT" as const : "DECLARED_TOTAL_REACHED" as const
          : "CONTINUE" as const,
      anomalyCodes: [],
      capturedAt: CAPTURED_AT,
      ...(options.channelIds?.[index] ? { channelId: options.channelIds[index] } : {})
    })),
    declaredCompleteness: options.channelIds?.[0] ? {
      kind: "OFFICIAL_TOTAL_COUNT" as const,
      value: ids.length,
      artifactLogicalKey: declarationArtifactLogicalKey,
      extractorLocator: declarationLocator,
      scope: "CHANNEL" as const,
      channelId: options.channelIds[0]
    } : {
      kind: "OFFICIAL_TOTAL_COUNT" as const,
      value: ids.length,
      artifactLogicalKey: declarationArtifactLogicalKey,
      extractorLocator: declarationLocator,
      scope: "SOURCE" as const
    },
    fetchCounts: {
      rawCount: ids.length,
      parsedCount: ids.length,
      validCount: ids.length,
      parseDiscardCount: 0,
      validationDiscardCount: 0
    },
    fetchLosses: []
  };
  const replay = {
    expectedChannelIds: [...new Set((options.channelIds ?? []).filter(
      (channelId): channelId is string => channelId !== undefined
    ))],
    filteredOutput: true,
    ...(options.missingReturnedPage ? { allowMissingReturnedPage: true } : {}),
    ...(options.laterZero ? { allowLaterZeroDeclaredTotalAfterExactReconciliation: true } : {})
  };
  const evidence = deriveCanonicalPaginationEvidence({ evidence: rawEvidence, ...replay });
  return {
    evidence,
    evaluation: evaluatePaginationEvidence({ evidence, ...replay })
  };
}

function withDeclaredArtifactUrls(
  evidence: PersistentSourceFetchEvidence,
  requestedUrl: string,
  finalUrl: string
): PersistentSourceFetchEvidence {
  const logicalKey = evidence.declaredCompleteness?.artifactLogicalKey;
  return {
    ...evidence,
    artifacts: evidence.artifacts.map((artifact) => artifact.logicalKey === logicalKey
      ? { ...artifact, requestedUrl, finalUrl }
      : artifact)
  };
}

function withArtifactUrls(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string,
  requestedUrl: string,
  finalUrl: string
): PersistentSourceFetchEvidence {
  return {
    ...evidence,
    artifacts: evidence.artifacts.map((artifact) => artifact.logicalKey === logicalKey
      ? { ...artifact, requestedUrl, finalUrl }
      : artifact)
  };
}

function withSupportingNetworkArtifact(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string,
  url: string,
  kind: "OFFICIAL_COMPANY_PAGE" | "ATS_API_RESPONSE" = "ATS_API_RESPONSE"
): PersistentSourceFetchEvidence {
  return {
    ...evidence,
    artifacts: [...evidence.artifacts, {
      id: logicalKey,
      logicalKey,
      kind,
      requestedUrl: url,
      finalUrl: url,
      httpStatus: 200,
      contentType: kind === "OFFICIAL_COMPANY_PAGE" ? "text/html" : "application/json",
      capturedAt: CAPTURED_AT,
      body: "{}",
      bodyRepresentation: "EXACT",
      extractorLocator: "test:supporting-scope"
    }]
  };
}

async function crawlWith(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  evaluation: PaginationEvaluation,
  ids: readonly string[] = ["job-1"],
  upstreamStatus: "VERIFIED" | "NEEDS_MANUAL_COMPLETENESS_REVIEW" = "NEEDS_MANUAL_COMPLETENESS_REVIEW"
) {
  return runSourceCrawl(plan, { fetch: async () => ({
    ok: true,
    capturedAt: CAPTURED_AT,
    payload: payloadFor(plan, ids),
    fetchEvidence: evidence,
    paginationEvaluation: evaluation,
    completeness: {
      completenessStatus: upstreamStatus,
      expectedJobCount: ids.length,
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: plan.source.officialEntryUrl
    }
  }) });
}

describe("strict positive official-total completeness policy", () => {
  it.each([
    ["unrelated origin", "https://attacker.example/api/jobs", "https://attacker.example/api/jobs"],
    ["official origin wrong path", "https://careers.lilly.com/not-widgets", "https://careers.lilly.com/not-widgets"],
    ["non-allowed redirect", "https://careers.lilly.com/widgets", "https://careers.lilly.com/not-widgets"]
  ])("rejects a valid declared first page followed by a %s", async (_label, requestedUrl, finalUrl) => {
    const plan = planFor("source-lilly-china-social");
    const ids = Array.from({ length: fixturePageSize(plan) + 1 }, (_, index) => `job-${index + 1}`);
    const { evidence, evaluation } = positiveCountEvidence(plan, { ids });
    const forged = withArtifactUrls(evidence, "page-2", requestedUrl, finalUrl);

    expect((await crawlWith(plan, forged, evaluation, ids)).truth.completenessVerified).toBe(false);
  });

  it.each(["ENTRY", "CHAIN"] as const)(
    "does not accept an official %s page as the positive total declaration endpoint",
    async (role) => {
      const plan = planFor("source-lilly-china-social");
      const { evidence, evaluation } = positiveCountEvidence(plan);
      const url = role === "ENTRY" ? plan.source.officialEntryUrl : plan.source.officialChainEvidenceUrl;
      const forged = withDeclaredArtifactUrls(evidence, url, url);

      expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
    }
  );

  it("requires exact configured query keys and values on supporting official entry artifacts", async () => {
    const plan = planFor("source-ucb-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const withoutRequiredQuery = new URL(plan.source.officialEntryUrl);
    withoutRequiredQuery.search = "";
    const forged = withSupportingNetworkArtifact(
      evidence,
      "scope-entry",
      withoutRequiredQuery.toString(),
      "OFFICIAL_COMPANY_PAGE"
    );

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["bare endpoint", (url: URL) => { url.search = ""; }],
    ["missing country", (url: URL) => { url.searchParams.delete("views-filter[field_job_country]"); }],
    ["wrong functional area", (url: URL) => { url.searchParams.set("views-filter[field_job_functional_area]", "Sales"); }],
    ["wrong target", (url: URL) => { url.searchParams.set("views-filter[field_job_country]", "999"); }],
    ["nonempty date", (url: URL) => { url.searchParams.set("views-filter[field_job_posted_date][min]", "2026-01-01"); }],
    ["extra key", (url: URL) => { url.searchParams.set("extra", "1"); }],
    ["duplicate key", (url: URL) => { url.searchParams.append("views-filter[field_job_country]", "806"); }]
  ])("rejects a Sandoz primary declaration with %s", async (_label, mutate) => {
    const plan = planFor("source-sandoz-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const forgedUrl = new URL(sandozProbeUrl(plan, "primary", 0));
    mutate(forgedUrl);
    const forged = withDeclaredArtifactUrls(evidence, forgedUrl.toString(), forgedUrl.toString());

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["alternate probe", "alt1" as const, 0],
    ["later primary page", "primary" as const, 1]
  ])("rejects a Sandoz %s as the declared total artifact", async (_label, probe, page) => {
    const plan = planFor("source-sandoz-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const url = sandozProbeUrl(plan, probe, page);
    const forged = withDeclaredArtifactUrls(evidence, url, url);

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["taxonomy target drift", (plan: SourceCrawlPlan) => {
      if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "sandoz-jsonapi") throw new Error("Sandoz");
      return `${plan.officialJsonFetch.taxonomyEndpointUrl}?filter%5Bdrupal_internal__tid%5D=999`;
    }],
    ["alternate probe path drift", (plan: SourceCrawlPlan) => {
      const url = new URL(sandozProbeUrl(plan, "alt1", 0));
      url.pathname = "/jsonapi/views/job_search/wrong";
      return url.toString();
    }]
  ])("rejects a Sandoz supporting scope artifact with %s", async (_label, badUrl) => {
    const plan = planFor("source-sandoz-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const forged = withSupportingNetworkArtifact(evidence, "scope-support", badUrl(plan));

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("accepts an explicitly named canonical channel only when the declaration is channel-bound", async () => {
    const plan = planFor("source-lilly-china-social");
    const channelId = plan.expectedChannels?.[0]?.channelId;
    if (!channelId) throw new Error("Expected canonical channel");
    const { evidence, evaluation } = positiveCountEvidence(plan, { channelIds: [channelId] });

    expect((await crawlWith(plan, evidence, evaluation)).truth.completenessVerified).toBe(true);
  });

  it.each(STRICT_URL_STRATEGY_SOURCES)(
    "accepts only the real plan-derived declared-artifact endpoint for %s",
    async (sourceId) => {
      const plan = planFor(sourceId);
      const { evidence, evaluation } = positiveCountEvidence(plan);

      expect((await crawlWith(plan, evidence, evaluation)).truth.completenessVerified).toBe(true);
    }
  );

  it("rejects a declared artifact on an unrelated domain", async () => {
    const plan = planFor("source-lilly-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const forged = withDeclaredArtifactUrls(
      evidence,
      "https://attacker.example/api/jobs",
      "https://attacker.example/api/jobs"
    );

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("rejects a declared artifact on the official origin but the wrong path", async () => {
    const plan = planFor("source-lilly-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const wrongPath = new URL("/unrelated/export", plan.source.officialEntryUrl).toString();
    const forged = withDeclaredArtifactUrls(evidence, wrongPath, wrongPath);

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("rejects a declaration redirected away from the allowed strategy endpoint", async () => {
    const plan = planFor("source-pfizer-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const requestedUrl = declaredArtifactUrl(plan);
    const forged = withDeclaredArtifactUrls(
      evidence,
      requestedUrl,
      new URL("/not-the-workday-jobs-endpoint", plan.source.officialEntryUrl).toString()
    );

    expect((await crawlWith(plan, forged, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("requires an executable plan channel binding instead of trusting source-level upstream evidence", async () => {
    const staged = planFor("source-lilly-china-social");
    const { expectedChannels: _channels, expectedChannelSetHash: _hash, ...unbound } = staged;
    const { evidence, evaluation } = positiveCountEvidence(staged);

    expect((await crawlWith(unbound as SourceCrawlPlan, evidence, evaluation))
      .truth.completenessVerified).toBe(false);
  });

  it("rejects a channel named by evidence when it is not the plan's canonical default channel", async () => {
    const plan = planFor("source-lilly-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan, { channelIds: ["source:forged:default"] });
    expect(evaluation).toMatchObject({ safeCompleteness: true, visitedChannelIds: ["source:forged:default"] });

    expect((await crawlWith(plan, evidence, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("rejects mixed implicit source and explicit channel evidence", async () => {
    const plan = planFor("source-lilly-china-social");
    const defaultChannel = plan.expectedChannels?.[0]?.channelId;
    if (!defaultChannel) throw new Error("Expected staged default channel");
    const { evidence, evaluation } = positiveCountEvidence(plan, {
      ids: ["job-1", "job-2"],
      channelIds: [undefined, defaultChannel]
    });

    expect((await crawlWith(plan, evidence, evaluation, ["job-1", "job-2"]))
      .truth.completenessVerified).toBe(false);
  });

  it("rejects implicit source evidence for a plan claiming multiple expected channels", async () => {
    const plan = planFor("source-lilly-china-social");
    const expectedChannels = [
      { channelId: `source:${plan.source.id}:default`, kind: "SOCIAL" as const },
      { channelId: `source:${plan.source.id}:secondary`, kind: "SOCIAL" as const }
    ];
    const forged = {
      ...plan,
      expectedChannels,
      expectedChannelSetHash: expectedChannelSetHash(expectedChannels)
    } as SourceCrawlPlan;
    const { evidence, evaluation } = positiveCountEvidence(plan);

    expect((await crawlWith(forged, evidence, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("does not trust a forged upstream visited-channel list", async () => {
    const plan = planFor("source-lilly-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const forged = { ...evaluation, visitedChannelIds: ["source:forged:default"] };

    expect((await crawlWith(plan, evidence, forged)).truth.completenessVerified).toBe(false);
  });

  it.each(AUDITED_POSITIVE_TOTAL_SOURCES)(
    "promotes %s only after the common adapter ledger closes losslessly",
    async (sourceId) => {
      const plan = planFor(sourceId);
      const { evidence, evaluation } = positiveCountEvidence(plan);
      expect(evaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });

      const result = await crawlWith(plan, evidence, evaluation);

      const failClosed = fixtureExpectedToFailClosed(plan);

      expect(result).toMatchObject({
        status: "SUCCESS",
        truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: !failClosed },
        observation: {
          completenessStatus: failClosed ? "NEEDS_MANUAL_COMPLETENESS_REVIEW" : "VERIFIED",
          expectedJobCount: 1,
          structuredJobCount: 1
        },
        reconciliation: {
          rawInputCount: 1,
          parsedCount: 1,
          validBeforeDedupeCount: 1,
          dedupeInputCount: 1,
          dedupeOutputCount: 1,
          adapterLosses: [],
          collisionGroups: []
        }
      });
    }
  );

  it("replays Beisen missing returned-page coordinates only for the matching ATS strategy", async () => {
    const plan = planFor("source-cttq-social");
    const { evidence, evaluation } = positiveCountEvidence(plan, { missingReturnedPage: true });
    expect(evaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
    expect((await crawlWith(plan, evidence, evaluation)).truth.completenessVerified).toBe(true);

    const mismatched = {
      ...plan,
      source: { ...plan.source, atsKind: "OFFICIAL_JSON" }
    } as SourceCrawlPlan;
    expect((await crawlWith(mismatched, evidence, evaluation)).truth.completenessVerified).toBe(false);
  });

  it("uses the same Beisen pagination replay policy when issuing the A-grade certificate", async () => {
    const plan = planFor("source-cttq-social");
    const { evidence, evaluation } = positiveCountEvidence(plan, { missingReturnedPage: true });
    const crawled = await crawlWith(plan, evidence, evaluation);
    const declaration = crawled.fetchEvidence?.declaredCompleteness;
    const officialArtifact = crawled.fetchEvidence?.artifacts.find(
      ({ logicalKey }) => logicalKey === declaration?.artifactLogicalKey
    );
    if (!crawled.fetchEvidence || !crawled.paginationEvaluation || !crawled.reconciliation ||
        !officialArtifact) throw new Error("Expected exact Beisen certificate evidence");
    const bytes = typeof officialArtifact.body === "string"
      ? Buffer.from(officialArtifact.body, "utf8")
      : Buffer.from(officialArtifact.body);

    const decision = issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-beisen",
        batchId: "batch-beisen",
        sourceResultId: "result-beisen",
        sourceConfigSha256: sourcePlanConfigSha256(plan)
      },
      plan,
      transportSuccess: crawled.truth.transportSuccess,
      adapterSuccess: crawled.truth.adapterSuccess,
      evidence: crawled.fetchEvidence,
      paginationEvaluation: crawled.paginationEvaluation,
      reconciliation: crawled.reconciliation,
      jobs: crawled.jobs,
      officialArtifactSha256: sha256Bytes(bytes).sha256
    });

    expect(decision.status, JSON.stringify(decision)).toBe("CERTIFIED");
  });

  it("replays a Workday later-zero total only when the plan carries an audited policy", async () => {
    const plan = planFor("source-pfizer-china-social");
    const ids = Array.from({ length: fixturePageSize(plan) + 1 }, (_, index) => `job-${index + 1}`);
    const { evidence, evaluation } = positiveCountEvidence(plan, { ids, laterZero: true });
    expect(evaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
    expect((await crawlWith(plan, evidence, evaluation, ids)).truth.completenessVerified).toBe(true);

    if (plan.adapterId !== "official-json" || !plan.workday) throw new Error("Expected Workday plan");
    const { laterZeroTotalPolicy: _policy, ...workday } = plan.workday;
    const unverifiedPolicy = { ...plan, workday } as SourceCrawlPlan;
    expect((await crawlWith(unverifiedPolicy, evidence, evaluation, ids))
      .truth.completenessVerified).toBe(false);
  });

  it("does not accept a forged upstream VERIFIED status without a supported plan strategy", async () => {
    const supported = planFor("source-lilly-china-social");
    if (supported.adapterId !== "official-json") throw new Error("Expected official-json plan");
    const { officialJsonFetch: _strategy, ...unsupported } = supported;
    const plan = unsupported as SourceCrawlPlan;
    const { evidence, evaluation } = positiveCountEvidence(supported);
    const forged = { ...evaluation, verifiedEligible: true };

    const result = await crawlWith(plan, evidence, forged, ["job-1"], "VERIFIED");

    expect(result.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: true,
      completenessVerified: false
    });
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });

  it("holds certification when adapter validation loses a row or dedupe finds a collision", async () => {
    const plan = planFor("source-lilly-china-social");
    const ids = ["job-1", "job-2"];
    const { evidence, evaluation } = positiveCountEvidence(plan, { ids });
    const payload = payloadFor(plan, ids) as { jobs: Array<Record<string, unknown>> };
    const withLoss = structuredClone(payload);
    withLoss.jobs[1]!.title = "";
    const lost = await runSourceCrawl(plan, { fetch: async () => ({
      ok: true,
      capturedAt: CAPTURED_AT,
      payload: withLoss,
      fetchEvidence: evidence,
      paginationEvaluation: evaluation,
      completeness: { completenessStatus: "VERIFIED" }
    }) });
    expect(lost.truth.completenessVerified).toBe(false);
    expect(lost.reconciliation).toMatchObject({
      rawInputCount: 2,
      validBeforeDedupeCount: 1,
      dedupeOutputCount: 1,
      adapterLosses: [{ stage: "VALIDATION" }]
    });

    const withCollision = structuredClone(payload);
    withCollision.jobs[1]!.sourceJobId = "job-1";
    const collided = await runSourceCrawl(plan, { fetch: async () => ({
      ok: true,
      capturedAt: CAPTURED_AT,
      payload: withCollision,
      fetchEvidence: evidence,
      paginationEvaluation: evaluation,
      completeness: { completenessStatus: "VERIFIED" }
    }) });
    expect(collided.truth.completenessVerified).toBe(false);
    expect(collided.reconciliation).toMatchObject({
      rawInputCount: 2,
      dedupeInputCount: 2,
      dedupeOutputCount: 1,
      adapterLosses: [],
      collisionGroups: [{ droppedCount: 1 }]
    });
  });

  it("holds certification when fetch counts do not match adapter input or the total is global", async () => {
    const plan = planFor("source-lilly-china-social");
    const { evidence, evaluation } = positiveCountEvidence(plan);
    const countMismatch = await crawlWith(plan, evidence, evaluation, ["job-1", "job-2"], "VERIFIED");
    expect(countMismatch.status).toBe("FAILED");
    expect(countMismatch.truth).toEqual({
      transportSuccess: true,
      adapterSuccess: false,
      completenessVerified: false
    });

    const globalEvidence = {
      ...evidence,
      declaredCompleteness: {
        ...evidence.declaredCompleteness!,
        scope: "GLOBAL_UNFILTERED" as const
      }
    };
    const canonical = deriveCanonicalPaginationEvidence({
      evidence: globalEvidence,
      expectedChannelIds: [],
      filteredOutput: true
    });
    const globalEvaluation = evaluatePaginationEvidence({
      evidence: canonical,
      expectedChannelIds: [],
      filteredOutput: true
    });
    expect(globalEvaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
    expect((await crawlWith(plan, canonical, globalEvaluation, ["job-1"], "VERIFIED"))
      .truth.completenessVerified).toBe(false);
  });
});
