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
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import {
  createHttpHtmlSourceFetch,
  type HttpHtmlRequest,
  type HttpHtmlResponse
} from "../../src/crawler/httpHtmlSourceFetch";
import {
  createHotjobLegacySourceFetch,
  type HotjobLegacyHttpRequest
} from "../../src/crawler/hotjobLegacySourceFetch";
import {
  createWorkdaySourceFetch,
  type WorkdayHttpRequest
} from "../../src/crawler/workdaySourceFetch";
import {
  createMokaSourceFetch,
  type MokaEncryptedResponse,
  type MokaHttpClient,
  type MokaHttpResponse
} from "../../src/crawler/mokaSourceFetch";

const CAPTURED_AT = "2026-07-15T01:00:00.000Z";
const PLANS = buildStagedSourceCrawlPlans(candidateCompanies);
const SANDOZ_FIELDS = [
  "title", "field_job_title", "field_job_employment_type", "field_job_type", "field_job_id",
  "field_job_business_unit", "field_job_work_location", "field_job_posted_date", "path",
  "drupal_internal__tid", "field_date", "field_job_country", "field_job_alt_country_1",
  "field_job_alt_country_2", "field_job_alt_country_3"
].join(",");

function planFor(sourceId: string): SourceCrawlPlan {
  const plan = PLANS.find((candidate) => candidate.source.id === sourceId);
  if (!plan) throw new Error(`Missing staged plan ${sourceId}`);
  return structuredClone(plan);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments.at(-1)!] = value;
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
      officialPublishedAt: "2026-07-15"
    };
    for (const [field, configuredPath] of Object.entries(plan.json.fields)) {
      if (!(field in values) || !configuredPath) continue;
      for (const path of typeof configuredPath === "string" ? [configuredPath] : configuredPath) {
        setPath(row, path, values[field]);
      }
    }
    return row;
  });
  const payload: Record<string, unknown> = {};
  if (!plan.json.jobsPath) throw new Error("Expected jobs path");
  for (const path of typeof plan.json.jobsPath === "string" ? [plan.json.jobsPath] : plan.json.jobsPath) {
    setPath(payload, path, rows);
  }
  return payload;
}

function strategyPageSize(plan: SourceCrawlPlan): number {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  if (plan.workday) return plan.workday.pageSize ?? 20;
  if (plan.moka) return 50;
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") return strategy.pageSize ?? 50;
  if (strategy?.kind === "beisen-zhiye-2022") return strategy.pageSize ?? 100;
  if (strategy?.kind === "hcm-cloud") return strategy.pageSize ?? 20;
  if (strategy?.kind === "sandoz-jsonapi") return strategy.pageSize ?? 10;
  throw new Error(`Unsupported strict strategy ${plan.source.id}`);
}

function strategyName(plan: SourceCrawlPlan): "workday" | "moka" | "phenom" | "beisen" | "hcm" | "sandoz" {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  if (plan.workday) return "workday";
  if (plan.moka) return "moka";
  switch (plan.officialJsonFetch?.kind) {
    case "phenom": return "phenom";
    case "beisen-zhiye-2022": return "beisen";
    case "hcm-cloud": return "hcm";
    case "sandoz-jsonapi": return "sandoz";
    default: throw new Error(`Unsupported strict strategy ${plan.source.id}`);
  }
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

type PageCoordinates = {
  sequence: number;
  requestedCursor: string | null;
  requestedOffset: number | null;
  requestedPage: number | null;
  requestedPageSize: number | null;
};

function pageCoordinates(plan: SourceCrawlPlan, sequence: number): PageCoordinates {
  const size = strategyPageSize(plan);
  const strategy = strategyName(plan);
  if (["workday", "moka", "phenom"].includes(strategy)) {
    return { sequence, requestedCursor: null, requestedOffset: sequence * size,
      requestedPage: strategy === "workday" ? sequence : null, requestedPageSize: size };
  }
  return { sequence, requestedCursor: null, requestedOffset: null,
    requestedPage: strategy === "hcm" ? sequence + 1 : sequence,
    requestedPageSize: size };
}

function requestContractLocator(plan: SourceCrawlPlan, coordinates: PageCoordinates, base: string): string {
  const strategy = strategyName(plan);
  if (strategy === "sandoz") return base;
  const url = paginationUrl(plan, coordinates.sequence);
  const coordinate = strategy === "workday"
    ? { sequence: coordinates.sequence, requestedOffset: coordinates.requestedOffset,
        requestedPage: coordinates.requestedPage, requestedPageSize: coordinates.requestedPageSize }
    : strategy === "moka" || strategy === "phenom"
      ? { sequence: coordinates.sequence, requestedOffset: coordinates.requestedOffset,
          requestedPage: coordinates.requestedPage, requestedPageSize: coordinates.requestedPageSize }
      : { sequence: coordinates.sequence, requestedPage: coordinates.requestedPage,
          requestedPageSize: coordinates.requestedPageSize };
  const serialized = JSON.stringify(canonical({
    v: 2,
    family: strategy,
    role: "page",
    method: "POST",
    url,
    body: pageRequestBody(plan, coordinates),
    coordinate
  }));
  const hash = createHash("sha256").update(serialized, "utf8").digest("hex");
  return `${base}|request-contract-v2|sha256:${hash}`;
}

function pageRequestBody(plan: SourceCrawlPlan, coordinates: PageCoordinates): unknown {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  if (plan.workday) {
    const appliedFacets: Record<string, readonly string[]> = { ...(plan.workday.appliedFacets ?? {}) };
    if (plan.workday.facetDescriptorBoundary) {
      appliedFacets[plan.workday.facetDescriptorBoundary.facetParameter] =
        plan.workday.facetDescriptorBoundary.allowedDescriptors.map((_, index) => `workday-allowed-${index}`);
    }
    return { appliedFacets, ...(plan.workday.searchText ? { searchText: plan.workday.searchText } : {}),
      limit: coordinates.requestedPageSize, offset: coordinates.requestedOffset };
  }
  if (plan.moka) return {
    orgId: plan.moka.expectedOrgId, siteId: plan.moka.expectedSiteId, limit: 50,
    offset: coordinates.requestedOffset, needStat: true, isCampusJob: false,
    site: plan.moka.expectedMode, locale: "zh-CN"
  };
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") {
    const config = phenomPageConfig(plan);
    return { lang: config.locale, locale: config.locale, deviceType: config.deviceType, country: config.country,
      pageName: config.pageName, size: coordinates.requestedPageSize, from: coordinates.requestedOffset,
      jobs: true, counts: true, all_fields: ["category", "country", "state", "city", "type", "jobLevelId"],
      clearAll: false, jdsource: "facets", isSliderEnable: false, pageId: config.pageId,
      siteType: "external", keywords: "", global: true,
      selected_fields: { country: [strategy.countryFilter ?? "China"] },
      sort: { order: "desc", field: "postedDate" }, locationData: {}, refNum: config.refNum, ddoKey: "refineSearch" };
  }
  if (strategy?.kind === "beisen-zhiye-2022") return {
    PageIndex: coordinates.requestedPage, PageSize: coordinates.requestedPageSize,
    Category: [strategy.category ?? "1"], KeyWords: "", SpecialType: 0, PortalId: "",
    DisplayFields: strategy.displayFields ?? ["Category", "Kind", "LocId", "Salary", "Degree",
      "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode"]
  };
  if (strategy?.kind === "hcm-cloud") {
    return hcmListRequestBody(strategy, coordinates.requestedPage!, coordinates.requestedPageSize!);
  }
  throw new Error(`Unsupported strict request body ${plan.source.id}`);
}

function phenomPageConfig(plan: SourceCrawlPlan) {
  const origin = new URL(plan.source.officialEntryUrl).origin;
  return { widgetApiEndpoint: new URL("/widgets", origin).toString(), refNum: "strict-ref",
    locale: "en_US", deviceType: "desktop", country: "US", pageName: "search-results",
    pageId: "strict-page" };
}

function hcmListRequestBody(
  config: Extract<NonNullable<Extract<SourceCrawlPlan, { adapterId: "official-json" }>["officialJsonFetch"]>, { kind: "hcm-cloud" }>,
  page: number,
  pageSize: number
): Record<string, unknown> {
  return { model: "ReleaseJobMgr", filter_str: null,
    filter_dict: { job_class: config.jobClass ?? "社会招聘", status: "1", delivery: 1, contract_unit: null },
    page_index: page, page_size: pageSize,
    extra_property: { state: config.portalState ?? "portal_social",
      sorts: [{ type: "desc", key: "is_top" }, { key: "release_date", type: "desc" }, { type: "desc", key: "id" }],
      filter_params: { job_class: config.recruitType ?? "social", filter_dict: { select_depart: null },
        page_index: page, page_size: pageSize, filter_str: null, show_fields_key: [] }, only_list: true },
    biz_type: "list" };
}

function hcmCountRequestBody(plan: SourceCrawlPlan): Record<string, unknown> {
  if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "hcm-cloud") throw new Error("HCM");
  const list = hcmListRequestBody(plan.officialJsonFetch, 1, 20);
  const extra = { ...(list.extra_property as Record<string, unknown>) };
  delete extra.only_list;
  return { ...list, page_index: null, page_size: null, extra_property: extra,
    count_by: ["id"], sum_by: [], group_by: null, avg_by: [], min_by: [], max_by: [] };
}

function auxiliaryRequestContractLocator(base: string, contract: Record<string, unknown>): string {
  const hash = createHash("sha256").update(JSON.stringify(canonical({ v: 2, ...contract })), "utf8").digest("hex");
  return `${base}|request-contract-v2|sha256:${hash}`;
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
  url.searchParams.set("fields[node--jobs]", SANDOZ_FIELDS);
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

function paginationUrl(plan: SourceCrawlPlan, sequence: number): string {
  if (plan.adapterId !== "official-json") throw new Error("Expected official-json plan");
  const entry = new URL(plan.source.officialEntryUrl);
  if (plan.workday) return new URL(`/wday/cxs/${plan.workday.tenant}/${plan.workday.site}/jobs`, entry.origin).toString();
  if (plan.moka) return "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
  const strategy = plan.officialJsonFetch;
  if (strategy?.kind === "phenom") return new URL("/widgets", entry.origin).toString();
  if (strategy?.kind === "beisen-zhiye-2022") return new URL("/api/Jobad/GetJobAdPageList", entry.origin).toString();
  if (strategy?.kind === "hcm-cloud") return new URL("/api/hcm.model.list?model=ReleaseJobMgr", entry.origin).toString();
  if (strategy?.kind === "sandoz-jsonapi") return sandozProbeUrl(plan, "primary", sequence);
  throw new Error(`Unsupported strategy ${plan.source.id}`);
}

function declarationUrl(plan: SourceCrawlPlan): string {
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "hcm-cloud") {
    return new URL("/api/hcm.model.count?model=ReleaseJobMgr", plan.source.officialEntryUrl).toString();
  }
  return paginationUrl(plan, 0);
}

function evidenceFor(plan: SourceCrawlPlan, pageCount: 1 | 2): {
  evidence: PersistentSourceFetchEvidence;
  evaluation: PaginationEvaluation;
  ids: string[];
} {
  const size = strategyPageSize(plan);
  const ids = Array.from({ length: pageCount === 1 ? 1 : size + 1 }, (_, index) => `job-${index + 1}`);
  const groups = pageCount === 1 ? [ids] : [ids.slice(0, size), ids.slice(size)];
  const artifacts: PersistentSourceFetchEvidence["artifacts"] = [];
  const pages: PersistentSourceFetchEvidence["pages"] = [];
  if (plan.adapterId === "official-json" && plan.workday?.facetDescriptorBoundary) {
    const boundary = plan.workday.facetDescriptorBoundary;
    const descriptors = [...boundary.allowedDescriptors, ...(boundary.excludedDescriptors ?? [])];
    const responseBody = JSON.stringify({ total: ids.length, jobPostings: [], facets: [{
      facetParameter: boundary.facetParameter,
      values: descriptors.map((descriptor, index) => ({ descriptor,
        id: index < boundary.allowedDescriptors.length ? `workday-allowed-${index}` : `workday-excluded-${index}`,
        count: index === 0 ? ids.length : 0 }))
    }] });
    const url = paginationUrl(plan, 0);
    const preflightBody = { appliedFacets: { ...(plan.workday.appliedFacets ?? {}) }, limit: size, offset: 0 };
    artifacts.push({ id: "workday-facet-preflight-0000", logicalKey: "workday-facet-preflight-0000",
      kind: "ATS_API_RESPONSE", requestedUrl: url, finalUrl: url, httpStatus: 200,
      contentType: "application/json", capturedAt: CAPTURED_AT, body: responseBody,
      bodyRepresentation: "EXACT",
      extractorLocator: auxiliaryRequestContractLocator("$.facets", {
        family: "workday", role: "facet-preflight", method: "POST", url, body: preflightBody,
        coordinate: { sequence: null, requestedOffset: 0, requestedPageSize: size }
      }) });
  }
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "phenom") {
    const config = phenomPageConfig(plan);
    const entryEvidenceUrl = new URL(plan.source.officialEntryUrl);
    for (const key of [...entryEvidenceUrl.searchParams.keys()]) {
      if (["keyword", "keywords"].includes(key.toLowerCase())) entryEvidenceUrl.searchParams.delete(key);
    }
    artifacts.push({ id: "phenom-entry-0000", logicalKey: "phenom-entry-0000", kind: "OFFICIAL_COMPANY_PAGE",
      requestedUrl: entryEvidenceUrl.toString(), finalUrl: entryEvidenceUrl.toString(), httpStatus: 200,
      contentType: "text/html", capturedAt: CAPTURED_AT,
      body: `<html><script type="application/json">${JSON.stringify({ phApp: config })}</script></html>`,
      bodyRepresentation: "EXACT", extractorLocator: "phenom-entry-config-v1|test:independent-json" });
  }
  if (plan.adapterId === "official-json" && plan.moka) {
    artifacts.push({
      id: "moka-entry-0000",
      logicalKey: "moka-entry-0000",
      kind: "OFFICIAL_COMPANY_PAGE",
      requestedUrl: plan.source.officialEntryUrl,
      finalUrl: plan.moka.campaignUrl,
      httpStatus: 200,
      contentType: "text/html; charset=utf-8",
      capturedAt: CAPTURED_AT,
      body: mokaInitHtml(plan.moka.expectedOrgId, plan.moka.expectedSiteId),
      bodyRepresentation: "EXACT",
      extractorLocator: "html:#init-data[value]"
    });
  }
  if (plan.adapterId === "official-json" && plan.officialJsonFetch?.kind === "sandoz-jsonapi") {
    const strategy = plan.officialJsonFetch;
    const taxonomyUrl = new URL(strategy.taxonomyEndpointUrl);
    taxonomyUrl.searchParams.set("filter[drupal_internal__tid]", String(strategy.countryTermTargetId));
    artifacts.push({
      id: "sandoz-taxonomy",
      logicalKey: "sandoz-taxonomy",
      kind: "ATS_API_RESPONSE",
      requestedUrl: taxonomyUrl.toString(),
      finalUrl: taxonomyUrl.toString(),
      httpStatus: 200,
      contentType: "application/vnd.api+json",
      capturedAt: CAPTURED_AT,
      body: JSON.stringify({ data: [{
        type: "taxonomy_term--job_location",
        id: strategy.countryTermUuid,
        attributes: {
          drupal_internal__tid: strategy.countryTermTargetId,
          name: strategy.countryTermName
        }
      }] }),
      bodyRepresentation: "EXACT",
      extractorLocator: `sandoz-taxonomy-v1|target:${strategy.countryTermTargetId}|json:` +
        "$.data[0].type,$.data[0].id,$.data[0].attributes.drupal_internal__tid,$.data[0].attributes.name"
    });
    for (const probe of ["alt1", "alt2", "alt3"] as const) {
      const url = sandozProbeUrl(plan, probe, 0);
      artifacts.push({
        id: `sandoz-${probe}-zero`,
        logicalKey: `sandoz-${probe}-zero`,
        kind: "ATS_API_RESPONSE",
        requestedUrl: url,
        finalUrl: url,
        httpStatus: 200,
        contentType: "application/vnd.api+json",
        capturedAt: CAPTURED_AT,
        body: JSON.stringify({
          data: [],
          meta: { count: 0 },
          number_of_items_per_page: strategy.pageSize,
          links: { self: { href: url } }
        }),
        bodyRepresentation: "EXACT",
        extractorLocator: `sandoz-jsonapi-v2|probe:${probe}|page:0|page-size:${strategy.pageSize}` +
          "|fields:node--jobs-v1|json:$.data[*],$.meta.count,$.number_of_items_per_page," +
          "$.links.self.href,$.links.next.href"
      });
    }
  }
  for (let sequence = 0; sequence < groups.length; sequence += 1) {
    const pageIds = groups[sequence]!;
    const officialStrategy = plan.adapterId === "official-json" ? plan.officialJsonFetch : undefined;
    let body: string;
    if (plan.adapterId === "official-json" && plan.moka) {
      body = JSON.stringify(mokaEncryptedResponse({
        success: true,
        data: {
          offset: sequence * size,
          jobStats: { total: ids.length },
          jobs: pageIds.map((id) => ({
            id,
            title: `Official role ${id}`,
            locations: [{ cityName: "上海", country: "中国" }]
          }))
        }
      }));
    } else if (plan.adapterId === "official-json" && plan.workday) {
      body = JSON.stringify({ total: ids.length, jobPostings: pageIds.map((id) => ({
        title: `Official role ${id}`, externalPath: `/job/China/${id}`,
        locationsText: "Shanghai, China", bulletFields: [id]
      })) });
    } else if (officialStrategy?.kind === "phenom") {
      body = JSON.stringify({ refineSearch: { totalHits: ids.length, data: {
        jobs: pageIds.map((id) => ({ jobId: id, title: `Official role ${id}`,
          country: officialStrategy.countryFilter ?? "China" })),
        aggregations: []
      } } });
    } else {
      body = JSON.stringify({ total: ids.length, ids: pageIds });
    }
    const logicalKey = `page-${sequence + 1}`;
    const coordinates = pageCoordinates(plan, sequence);
    const locator = requestContractLocator(plan, coordinates, "json:total");
    const url = paginationUrl(plan, sequence);
    artifacts.push({ id: logicalKey, logicalKey, kind: "PAGINATION_PAGE", requestedUrl: url, finalUrl: url,
      httpStatus: 200, contentType: "application/json", capturedAt: CAPTURED_AT, body,
      bodyRepresentation: "EXACT", extractorLocator: locator });
    const hasNext = sequence < groups.length - 1;
    const returnedPage = ["workday", "beisen", "sandoz"].includes(strategyName(plan)) ? coordinates.requestedPage
      : strategyName(plan) === "hcm" ? coordinates.requestedPage : null;
    pages.push({
      sequence,
      artifactLogicalKey: logicalKey,
      requestedCursor: coordinates.requestedCursor,
      returnedCursor: null,
      requestedOffset: coordinates.requestedOffset,
      returnedOffset: coordinates.requestedOffset,
      requestedPage: coordinates.requestedPage,
      returnedPage,
      requestedPageSize: coordinates.requestedPageSize,
      returnedPageSize: strategyName(plan) === "sandoz" ? size : null,
      rawJobIds: pageIds,
      validJobIds: pageIds,
      declaredTotal: ids.length,
      declaredCount: null,
      declaredPages: groups.length,
      nextPageSignalBefore: sequence === 0 ? null : `next:${sequence}`,
      nextPageSignalAfter: hasNext ? `next:${sequence + 1}` : null,
      responseFingerprintSha256: createHash("sha256").update(body).digest("hex"),
      termination: hasNext ? "CONTINUE" : "DECLARED_TOTAL_REACHED",
      anomalyCodes: [],
      capturedAt: CAPTURED_AT
    });
  }

  let declarationArtifact = artifacts.find((artifact) => artifact.logicalKey === "page-1")!;
  if (declarationUrl(plan) !== paginationUrl(plan, 0)) {
    const body = JSON.stringify({ total: ids.length });
    const countUrl = declarationUrl(plan);
    declarationArtifact = {
      id: "hcm-count-0000", logicalKey: "hcm-count-0000", kind: "ATS_API_RESPONSE",
      requestedUrl: countUrl, finalUrl: countUrl, httpStatus: 200,
      contentType: "application/json", capturedAt: CAPTURED_AT, body,
      bodyRepresentation: "EXACT", extractorLocator: auxiliaryRequestContractLocator("json:total", {
        family: "hcm", role: "count", method: "POST", url: countUrl, body: hcmCountRequestBody(plan),
        coordinate: { sequence: null, requestedPage: null, requestedPageSize: null }
      })
    };
    artifacts.unshift(declarationArtifact);
  }

  const rawEvidence = {
    captureTool: { name: "strict-purpose-test", version: "1" },
    artifacts,
    pages,
    declaredCompleteness: {
      kind: "OFFICIAL_TOTAL_COUNT" as const,
      value: ids.length,
      artifactLogicalKey: declarationArtifact.logicalKey,
      extractorLocator: declarationArtifact.extractorLocator,
      scope: "SOURCE" as const
    },
    fetchCounts: { rawCount: ids.length, parsedCount: ids.length, validCount: ids.length,
      parseDiscardCount: 0, validationDiscardCount: 0 },
    fetchLosses: []
  };
  const replay = {
    expectedChannelIds: [],
    filteredOutput: true,
    allowPositiveOfficialTotalCountAfterAdapterReconciliation: true as const
  };
  const evidence = deriveCanonicalPaginationEvidence({ evidence: rawEvidence, ...replay });
  return { evidence, evaluation: evaluatePaginationEvidence({ evidence, ...replay }), ids };
}

async function crawlWith(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  evaluation: PaginationEvaluation,
  ids: readonly string[]
) {
  return runSourceCrawl(plan, { fetch: async () => ({
    ok: true,
    capturedAt: CAPTURED_AT,
    payload: payloadFor(plan, ids),
    fetchEvidence: evidence,
    paginationEvaluation: evaluation,
    completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
  }) });
}

function withArtifactUrl(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string,
  url: string
): PersistentSourceFetchEvidence {
  return { ...evidence, artifacts: evidence.artifacts.map((artifact) => artifact.logicalKey === logicalKey
    ? { ...artifact, requestedUrl: url, finalUrl: url }
    : artifact) };
}

function withArtifactLocator(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string,
  locator: string
): PersistentSourceFetchEvidence {
  return {
    ...evidence,
    artifacts: evidence.artifacts.map((artifact) => artifact.logicalKey === logicalKey
      ? { ...artifact, extractorLocator: locator }
      : artifact),
    declaredCompleteness: evidence.declaredCompleteness?.artifactLogicalKey === logicalKey
      ? { ...evidence.declaredCompleteness, extractorLocator: locator }
      : evidence.declaredCompleteness
  };
}

async function exactPfizerFetch(pageCount: 1 | 2) {
  const plan = planFor("source-pfizer-china-social");
  if (plan.adapterId !== "official-json" || !plan.workday) {
    throw new Error("Expected canonical staged Pfizer Workday plan");
  }
  const pageSize = plan.workday.pageSize ?? 20;
  const ids = Array.from({ length: pageCount === 1 ? 1 : pageSize + 1 }, (_, index) => `pfizer-${index + 1}`);
  const fetch = createWorkdaySourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request: WorkdayHttpRequest) => {
      const body = JSON.parse(request.body) as {
        appliedFacets: Record<string, string[]>;
        offset: number;
      };
      const response = (payload: unknown) => ({
        status: 200,
        body: JSON.stringify(payload),
        finalUrl: request.url,
        contentType: "application/json; charset=utf-8",
        capturedAt: CAPTURED_AT
      });
      return response({
        total: ids.length,
        jobPostings: ids.slice(body.offset, body.offset + pageSize).map((id) => ({
          title: `Official role ${id}`,
          externalPath: `/job/China/${id}`,
          locationsText: "Shanghai, China",
          bulletFields: [id],
          workerSubType: "Regular"
        }))
      });
    }
  });
  const fetched = await fetch(plan);
  if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) {
    throw new Error(fetched.ok ? "Expected complete Pfizer evidence" : fetched.failureReason);
  }
  return {
    plan,
    fetched: {
      ...fetched,
      fetchEvidence: fetched.fetchEvidence,
      paginationEvaluation: fetched.paginationEvaluation
    }
  };
}

describe("strict purpose-bound completeness gate RED", () => {
  it("rejects a STAGED Pfizer plan whose Workday country facet is not the canonical configured value", async () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies)
      .find((candidate) => candidate.source.id === "source-pfizer-china-social");
    if (!plan) throw new Error("Missing direct staged Pfizer plan");
    if (plan.adapterId !== "official-json" || !plan.workday) throw new Error("Expected Workday plan");
    const originalFacets = plan.workday.appliedFacets;
    if (!originalFacets) throw new Error("Expected canonical Pfizer country facets");
    let completenessVerified: boolean | undefined;
    try {
      plan.workday.appliedFacets = { Location_Country: ["forged-country-facet"] };
      const forged = evidenceFor(plan, 1);
      completenessVerified = (await crawlWith(
        plan,
        forged.evidence,
        forged.evaluation,
        forged.ids
      )).truth.completenessVerified;
    } finally {
      plan.workday.appliedFacets = originalFacets;
    }
    expect(completenessVerified).toBe(false);
  });

  it.each([
    ["real Workday detail", "/wday/cxs/pfizer/PfizerCareers/job/China-Role/REQ-1"],
    ["arbitrary tenant child", "/wday/cxs/pfizer/PfizerCareers/not-a-detail"]
  ])("rejects Pfizer page two when it is a %s URL", async (_label, pathname) => {
    const { plan, fetched } = await exactPfizerFetch(2);
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
    const forged = {
      ...fetched,
      fetchEvidence: withArtifactUrl(
        fetched.fetchEvidence,
        "workday-page-0001",
        new URL(pathname, plan.source.officialEntryUrl).toString()
      )
    };
    expect((await runSourceCrawl(plan, { fetch: async () => forged })).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["Moka detail", "source-hengrui-social", () => "https://app.mokahr.com/api/outer/ats-apply/website/job"],
    ["Moka entry", "source-hengrui-social", (plan: SourceCrawlPlan) => plan.source.officialEntryUrl],
    ["Phenom entry", "source-lilly-china-social", (plan: SourceCrawlPlan) => plan.source.officialEntryUrl],
    ["Beisen entry", "source-cttq-social", (plan: SourceCrawlPlan) => plan.source.officialEntryUrl],
    ["HCM count", "source-lunan-social", (plan: SourceCrawlPlan) => declarationUrl(plan)]
  ])("rejects a %s artifact masquerading as pagination", async (_label, sourceId, wrongUrl) => {
    const plan = planFor(sourceId);
    const baseline = evidenceFor(plan, 2);
    expect((await crawlWith(plan, baseline.evidence, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(true);
    const forged = withArtifactUrl(baseline.evidence, "page-2", wrongUrl(plan));
    expect((await crawlWith(plan, forged, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(false);
  });

  it.each([
    ["Workday", "source-pfizer-china-social"],
    ["Moka", "source-hengrui-social"],
    ["Phenom", "source-lilly-china-social"],
    ["Beisen", "source-cttq-social"],
    ["HCM", "source-lunan-social"]
  ])("rejects %s evidence when the request contract is tampered but URL and count remain valid", async (_label, sourceId) => {
    if (sourceId === "source-pfizer-china-social") {
      const { plan, fetched } = await exactPfizerFetch(1);
      expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
      const forged = {
        ...fetched,
        fetchEvidence: withArtifactLocator(
          fetched.fetchEvidence,
          "workday-page-0000",
          "json:total|request-contract-v2|sha256:" + "0".repeat(64)
        )
      };
      expect((await runSourceCrawl(plan, { fetch: async () => forged })).truth.completenessVerified).toBe(false);
      return;
    }
    const plan = planFor(sourceId);
    const baseline = evidenceFor(plan, 1);
    expect((await crawlWith(plan, baseline.evidence, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(true);
    const forged = withArtifactLocator(baseline.evidence, "page-1", "json:total|request-contract-v2|sha256:" + "0".repeat(64));
    expect((await crawlWith(plan, forged, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(false);
  });

  it("requires canonical STAGED authority even after a renamed source recomputes its channel hash", async () => {
    const canonicalPlan = planFor("source-lilly-china-social");
    const baseline = evidenceFor(canonicalPlan, 1);
    const renamedSourceId = "source-renamed-lilly-social";
    const expectedChannels = [{ channelId: `source:${renamedSourceId}:default`, kind: "SOCIAL" as const }];
    const { executionAuthority: _authority, ...withoutAuthority } = canonicalPlan;
    const forgedPlan = {
      ...withoutAuthority,
      source: { ...canonicalPlan.source, id: renamedSourceId },
      expectedChannels,
      expectedChannelSetHash: expectedChannelSetHash(expectedChannels)
    } as SourceCrawlPlan;
    expect((await crawlWith(forgedPlan, baseline.evidence, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(false);
  });

  it("rejects an unreferenced network artifact carrying a channel outside the staged plan", async () => {
    const plan = planFor("source-lilly-china-social");
    const baseline = evidenceFor(plan, 1);
    const forged: PersistentSourceFetchEvidence = {
      ...baseline.evidence,
      artifacts: [...baseline.evidence.artifacts, {
        id: "unreferenced-scope",
        logicalKey: "unreferenced-scope",
        kind: "OFFICIAL_COMPANY_PAGE",
        channelId: "source:outside-plan:default",
        requestedUrl: plan.source.officialEntryUrl,
        finalUrl: plan.source.officialEntryUrl,
        httpStatus: 200,
        contentType: "text/html",
        capturedAt: CAPTURED_AT,
        body: "<html></html>",
        bodyRepresentation: "EXACT",
        extractorLocator: "html:scope"
      }]
    };
    expect((await crawlWith(plan, forged, baseline.evaluation, baseline.ids)).truth.completenessVerified).toBe(false);
  });

});

const MOKA_AES_IV = "de7c21ed8d6f50fe";
const MOKA_AES_KEY = "6e9ecb8e9c6c1a5e";

function mokaEncryptedResponse(payload: unknown): MokaEncryptedResponse {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(MOKA_AES_KEY), Buffer.from(MOKA_AES_IV));
  let data = cipher.update(JSON.stringify(payload), "utf8", "base64");
  data += cipher.final("base64");
  return { data, necromancer: MOKA_AES_KEY };
}

function mokaInitHtml(orgId: string, siteId: string): string {
  const value = JSON.stringify({
    aesIv: MOKA_AES_IV,
    mode: "social",
    siteId,
    org: { id: orgId, siteId }
  }).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return `<input id="init-data" value="${value}">`;
}

function mokaResponse(body: string, finalUrl: string, contentType = "application/json"): MokaHttpResponse {
  return { status: 200, body, finalUrl, contentType, capturedAt: CAPTURED_AT };
}

describe("strict Moka hydration evidence", () => {
  it("accepts a profile-authorized request-bound omitted detail siteId and rejects removal of its evidence", async () => {
    const plan = planFor("source-servier-china-social");
    if (plan.adapterId !== "official-json" || !plan.moka) throw new Error("Expected Moka plan");
    const listUrl = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";
    const detailUrl = "https://app.mokahr.com/api/outer/ats-apply/website/job";
    const http: MokaHttpClient = async (request) => {
      if (request.method === "GET") {
        return mokaResponse(mokaInitHtml(plan.moka!.expectedOrgId, plan.moka!.expectedSiteId),
          plan.moka!.campaignUrl, "text/html; charset=utf-8");
      }
      if (request.url === listUrl) {
        return mokaResponse(JSON.stringify(mokaEncryptedResponse({
          success: true,
          data: { jobStats: { total: 1 }, jobs: [{ id: "servier-1", title: "医学信息沟通专员" }] }
        })), listUrl);
      }
      return mokaResponse(JSON.stringify(mokaEncryptedResponse({
        success: true,
        data: {
          id: "servier-1",
          orgId: plan.moka!.expectedOrgId,
          locations: [{ cityName: "北京市", provinceName: "北京市", country: "中国" }]
        }
      })), detailUrl);
    };
    const fetched = await createMokaSourceFetch({ http, now: () => new Date(CAPTURED_AT) })(plan);
    if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) {
      throw new Error(fetched.ok ? "Missing Moka evidence" : fetched.failureReason);
    }
    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
    const stripped = {
      ...fetched,
      fetchEvidence: {
        ...fetched.fetchEvidence,
        artifacts: fetched.fetchEvidence.artifacts.filter((artifact) => !artifact.logicalKey.startsWith("moka-detail-"))
      }
    };
    expect((await runSourceCrawl(plan, { fetch: async () => stripped })).truth.completenessVerified).toBe(false);
  });
});

function htmlResponse(request: HttpHtmlRequest, body: string): HttpHtmlResponse {
  return { status: 200, body, finalUrl: request.url, contentType: "text/html", capturedAt: CAPTURED_AT };
}

const TEVA_ZERO = {
  positions: [], count: 0, location_used: "China",
  query: { query: "", location: "China", department: [], skill: [], seniority: [], pid: "" },
  all_applicable_locations: []
};

function encodedJson(value: unknown): string {
  return JSON.stringify(value).replace(/"/g, "&#34;");
}

describe("real staged non-regression plans", () => {
  it("keeps the real staged dynamic-scope Pfizer Workday request contract VERIFIED", async () => {
    const { plan, fetched } = await exactPfizerFetch(1);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result).toMatchObject({ status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 },
      fetchEvidence: { pages: [{ requestedPageSize: 20 }] } });
    expect(fetched.fetchEvidence.artifacts.find((artifact) => artifact.logicalKey === "workday-page-0000")
      ?.extractorLocator).toMatch(/\|request-contract-v2\|sha256:[0-9a-f]{64}$/u);
  });

  it("keeps the real staged Teva official zero VERIFIED", async () => {
    const plan = planFor("source-teva-china-social");
    const fetch = createHttpHtmlSourceFetch({ now: () => new Date(CAPTURED_AT), http: async request => htmlResponse(
      request,
      `<html><head><meta name="_csrf" content="public-token"></head><body>` +
      `<code id="smartApplyData" style="display:none">${encodedJson(TEVA_ZERO)}</code></body></html>`
    ) });
    const fetched = await fetch(plan);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result).toMatchObject({ status: "SUCCESS", jobs: [],
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 0 } });
  });

  it("keeps a real staged static official list COMPLETE_PAGE_TRAVERSAL VERIFIED", async () => {
    const plan = planFor("source-otsuka-china-social");
    const fetch = createHttpHtmlSourceFetch({ now: () => new Date(CAPTURED_AT), http: async request => htmlResponse(
      request,
      `<section class="container Box"><article class="job-item" data-job-id="medical-manager">医学经理</article></section>`
    ) });
    const fetched = await fetch(plan);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result).toMatchObject({ status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", structuredJobCount: 1,
        completenessEvidenceKind: "COMPLETE_PAGE_TRAVERSAL" } });
  });

  it("keeps the real staged CR Pharma hotjobLegacy list VERIFIED", async () => {
    const plan = planFor("source-cr-pharma-social");
    const fetch = createHotjobLegacySourceFetch({ now: () => new Date(CAPTURED_AT), http: async (request: HotjobLegacyHttpRequest) => ({
      status: 200,
      body: JSON.stringify({ pageCount: 1, page: 1, rowCount: 1, rowSize: 10,
        postList: [{ postId: 1127, postName: "自动化生产管理岗", workPlace: "成都市" }] }),
      finalUrl: request.url,
      contentType: "text/html;charset=utf-8",
      capturedAt: CAPTURED_AT
    }) });
    const fetched = await fetch(plan);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result).toMatchObject({ status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 } });

    const declaration = result.fetchEvidence?.declaredCompleteness;
    const officialArtifact = result.fetchEvidence?.artifacts.find(
      (artifact) => artifact.logicalKey === declaration?.artifactLogicalKey
    );
    if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation || !officialArtifact) {
      throw new Error("Expected exact CR Pharma certificate inputs");
    }
    const officialArtifactBytes = typeof officialArtifact.body === "string"
      ? Buffer.from(officialArtifact.body, "utf8")
      : Buffer.from(officialArtifact.body);
    const certificate = issueAGradeOfficialTotalCertificate({
      binding: {
        releaseCandidateId: "rc-cr-pharma",
        batchId: "batch-cr-pharma",
        sourceResultId: "result-cr-pharma",
        sourceConfigSha256: sourcePlanConfigSha256(plan)
      },
      plan,
      transportSuccess: result.truth.transportSuccess,
      adapterSuccess: result.truth.adapterSuccess,
      evidence: result.fetchEvidence,
      paginationEvaluation: result.paginationEvaluation,
      reconciliation: result.reconciliation,
      jobs: result.jobs,
      officialArtifactSha256: createHash("sha256").update(officialArtifactBytes).digest("hex")
    });
    expect(certificate.status, JSON.stringify(certificate)).toBe("CERTIFIED");

    if (!fetched.ok || !fetched.fetchEvidence) throw new Error("Expected exact CR Pharma evidence");
    const forgedEvidence = {
      ...fetched.fetchEvidence,
      artifacts: fetched.fetchEvidence.artifacts.map((artifact) => ({
        ...artifact,
        body: typeof artifact.body === "string"
          ? artifact.body.replace('"rowCount":1', '"rowCount":2')
          : artifact.body
      }))
    };
    const forged = await runSourceCrawl(plan, { fetch: async () => ({
      ...fetched,
      fetchEvidence: forgedEvidence
    }) });
    expect(forged.truth.completenessVerified).toBe(false);
  });
});
