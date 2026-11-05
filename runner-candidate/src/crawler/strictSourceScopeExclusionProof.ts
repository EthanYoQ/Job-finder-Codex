import { createHash } from "node:crypto";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";
import { isStrictQiluOfficialJobUrl } from "./qiluRenderedTraversalValidator";
import { hasExactFosunMainlandGeography, mainlandDisplayCities } from "./fosunScopeGeography";
import { containsSensitiveAdapterValue } from "./adapters/safeAdapterValue";

type OfficialPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;
type ProofPolicy =
  | "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
  | "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1"
  | "NHU_EXPLICIT_JAPAN_ONLY_V1"
  | "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2"
  | "THREESBIO_XIANYANG_HOMOGRAPH_V1"
  | "XIUZHENG_NON_RECRUITMENT_TITLE_V1";

interface Binding {
  policy: ProofPolicy;
  companyId: string;
  sourceId: string;
  atsKind: "BEISEN_ZHIYE" | "OFFICIAL_JSON";
  entryUrl: string;
  chainUrl: string;
}

const BINDINGS: Readonly<Record<ProofPolicy, Binding>> = {
  DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1: {
    policy: "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1",
    companyId: "company-dongyangguang",
    sourceId: "source-dongyangguang-social",
    atsKind: "BEISEN_ZHIYE",
    entryUrl: "https://hec.zhiye.com/Social/jobs",
    chainUrl: "https://www.hec.cn/"
  },
  FOSUN_EXPLICIT_HONG_KONG_ONLY_V1: {
    policy: "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1",
    companyId: "company-fosun-pharma",
    sourceId: "source-fosun-pharma-social",
    atsKind: "BEISEN_ZHIYE",
    entryUrl: "https://fosunpharma.zhiye.com/social",
    chainUrl: "https://www.fosunpharma.com/careers/"
  },
  NHU_EXPLICIT_JAPAN_ONLY_V1: {
    policy: "NHU_EXPLICIT_JAPAN_ONLY_V1",
    companyId: "company-nhu",
    sourceId: "source-nhu-social",
    atsKind: "BEISEN_ZHIYE",
    entryUrl: "https://xinhecheng1.zhiye.com/social/jobs",
    chainUrl: "https://www.cnhu.com/careers/zh-cn"
  },
  QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2: {
    policy: "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2",
    companyId: "company-qilu",
    sourceId: "source-qilu-social",
    atsKind: "BEISEN_ZHIYE",
    entryUrl: "https://qilu-pharma.zhiye.com/social/jobs",
    chainUrl: "https://www.qilu-pharma.com/JobPosting_list.html"
  },
  THREESBIO_XIANYANG_HOMOGRAPH_V1: {
    policy: "THREESBIO_XIANYANG_HOMOGRAPH_V1",
    companyId: "company-3sbio",
    sourceId: "source-3sbio-social",
    atsKind: "BEISEN_ZHIYE",
    entryUrl: "https://3sbio.zhiye.com/social/jobs",
    chainUrl: "https://www.3sbio.com/career/occupation.aspx"
  },
  XIUZHENG_NON_RECRUITMENT_TITLE_V1: {
    policy: "XIUZHENG_NON_RECRUITMENT_TITLE_V1",
    companyId: "company-xiuzheng",
    sourceId: "source-xiuzheng-social",
    atsKind: "OFFICIAL_JSON",
    entryUrl: "https://www.xiuzheng.com/#/recruit",
    chainUrl: "https://www.xiuzheng.com/"
  }
};

/**
 * Replays only the explicitly configured source-scoped exclusion/correction policies.
 * This is intentionally independent from the fetcher's scope/title classifiers.
 */
export function validateStrictSourceScopeExclusionProof(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[] = []
): boolean {
  try {
    if (plan.adapterId !== "official-json" || plan.executionAuthority !== "STAGED" ||
        evidence.supportingArtifactOnlyFailure || !exactTraversalDeclaration(evidence)) return false;
    const policy = configuredPolicy(plan);
    if (!policy || !exactPlanBinding(plan, BINDINGS[policy]) || !exactConfiguredPolicy(plan, policy)) return false;
    if (evidence.artifacts.length !== evidence.pages.length || evidence.pages.length === 0 ||
        evidence.fetchCounts.parseDiscardCount !== 0 ||
        evidence.fetchCounts.validationDiscardCount !== evidence.fetchLosses.length) return false;
    return policy === "XIUZHENG_NON_RECRUITMENT_TITLE_V1"
      ? replayXiuzheng(plan, evidence)
      : replayBeisen(plan, evidence, policy, outputJobs);
  } catch {
    return false;
  }
}

/** Replays raw Qilu loss rows only. It does not bind a plan, admit a policy or issue proof. */
export function validateQiluForeignLossRowsForDiagnostic(evidence: PersistentSourceFetchEvidence): boolean {
  try { return exactLossIndexes(evidence, exactQiluUnitedStatesOrHongKongScope) !== undefined; }
  catch { return false; }
}

export function strictQiluRawOfficialUrls(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[] = []
): string[] | undefined {
  if (plan.source.id !== "source-qilu-social" ||
      !validateStrictSourceScopeExclusionProof(plan, evidence, outputJobs)) return undefined;
  const urls: string[] = [];
  for (const page of evidence.pages) {
    const artifact = exactPageArtifact(evidence, page.artifactLogicalKey);
    const root = artifact && parseExactJsonRecord(artifact);
    if (!root || !Array.isArray(root.Data)) return undefined;
    for (const raw of root.Data) {
      if (!strictRecord(raw) || typeof raw.Id !== "string" || raw.Id !== raw.Id.trim()) return undefined;
      const url = new URL("/social/detail", plan.source.officialEntryUrl);
      url.searchParams.set("jobAdId", raw.Id);
      if (!isStrictQiluOfficialJobUrl(url.toString())) return undefined;
      urls.push(url.toString());
    }
  }
  return new Set(urls).size === urls.length ? urls : undefined;
}

function configuredPolicy(plan: OfficialPlan): ProofPolicy | undefined {
  const config = plan.officialJsonFetch;
  return config?.kind === "beisen-zhiye-2022" || config?.kind === "xiuzheng-job-list"
    ? config.scopeExclusionProof
    : undefined;
}

function exactPlanBinding(plan: OfficialPlan, binding: Binding): boolean {
  return plan.company.id === binding.companyId && plan.source.companyId === binding.companyId &&
    plan.source.id === binding.sourceId && plan.source.kind === "SOCIAL" &&
    plan.source.atsKind === binding.atsKind && plan.source.status === "VERIFIED_SCRAPABLE" &&
    plan.source.officialEntryUrl === binding.entryUrl &&
    plan.source.officialChainEvidenceUrl === binding.chainUrl;
}

function exactConfiguredPolicy(plan: OfficialPlan, policy: ProofPolicy): boolean {
  const config = plan.officialJsonFetch;
  if (policy === "XIUZHENG_NON_RECRUITMENT_TITLE_V1") {
    return config?.kind === "xiuzheng-job-list" &&
      config.scopeExclusionProof === policy &&
      config.endpointUrl === "https://www.xiuzheng.com/front/human-resource/job-list" &&
      config.detailBaseUrl === "https://www.xiuzheng.com/#/recruitDetail" &&
      config.defaultLocationRaw === "未披露" && config.pageSize === 10 && config.maxPages === 5;
  }
  if (policy === "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1") {
    if (config?.kind !== "beisen-zhiye-2022" || plan.company.category !== "DOMESTIC_PHARMA" ||
        Object.keys(config).sort().join(",") !==
          ["kind", "geographyScope", "category", "pageSize", "maxPages", "detailPath", "scopeExclusionProof"].sort().join(",") ||
        plan.json.jobsPath !== "jobs" || plan.json.defaultCategory !== "其他" ||
        Object.keys(plan.json).sort().join(",") !== "defaultCategory,fields,jobsPath" ||
        Object.keys(plan.json.fields).sort().join(",") !== "cities,locationRaw,officialTitle,officialUrl,sourceJobId" ||
        plan.json.fields.sourceJobId !== "sourceJobId" || plan.json.fields.officialTitle !== "title" ||
        plan.json.fields.officialUrl !== "officialUrl" || plan.json.fields.locationRaw !== "locationRaw" ||
        plan.json.fields.cities !== "cities") return false;
  }
  const expectedDetailPath = policy === "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
    ? "Social/detail"
    : "social/detail";
  const expectedMixedLocationPolicy = policy === "NHU_EXPLICIT_JAPAN_ONLY_V1"
    ? "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
    : undefined;
  return config?.kind === "beisen-zhiye-2022" && config.scopeExclusionProof === policy &&
    config.geographyScope === "DOMESTIC_OFFICIAL_TENANT" && config.category === "1" &&
    config.pageSize === 100 && config.maxPages === 5 && config.detailPath === expectedDetailPath &&
    config.mixedLocationPolicy === expectedMixedLocationPolicy;
}

function exactTraversalDeclaration(evidence: PersistentSourceFetchEvidence): boolean {
  const declaration = evidence.declaredCompleteness;
  const firstPage = evidence.pages[0];
  if (!declaration || !firstPage || declaration.kind !== "COMPLETE_PAGE_TRAVERSAL" ||
      declaration.scope !== "SOURCE" || declaration.channelId !== undefined ||
      declaration.value !== evidence.pages.length ||
      declaration.artifactLogicalKey !== firstPage.artifactLogicalKey) return false;
  const artifact = evidence.artifacts.find((candidate) => candidate.logicalKey === declaration.artifactLogicalKey);
  return artifact?.extractorLocator === declaration.extractorLocator;
}

function replayBeisen(
  plan: OfficialPlan,
  evidence: PersistentSourceFetchEvidence,
  policy: Exclude<ProofPolicy, "XIUZHENG_NON_RECRUITMENT_TITLE_V1">,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "beisen-zhiye-2022") return false;
  const endpoint = new URL("/api/Jobad/GetJobAdPageList", plan.source.officialEntryUrl).toString();
  const excludedByPage = exactLossIndexes(evidence, (raw) =>
    policy === "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1"
      ? exactFosunHongKongOnlyScope(raw)
      : policy === "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2"
      ? exactQiluUnitedStatesOrHongKongScope(raw)
      : policy === "NHU_EXPLICIT_JAPAN_ONLY_V1"
        ? exactJapanScope(raw)
      : policy === "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
        ? exactForeignScope(raw)
        : false);
  if (!excludedByPage) return false;

  let rawCount = 0;
  const fosunAllIds = new Set<string>();
  const fosunAcceptedRows: Record<string, unknown>[] = [];
  let exactHomographCorrections = 0;
  let declaredTotal: number | undefined;
  for (let sequence = 0; sequence < evidence.pages.length; sequence += 1) {
    const page = evidence.pages[sequence]!;
    const artifact = exactPageArtifact(evidence, page.artifactLogicalKey);
    const root = artifact && parseExactJsonRecord(artifact);
    if (!artifact || !root || root.Code !== 200 || !Array.isArray(root.Data) ||
        !nonnegativeSafeInteger(root.Count) ||
        (root.PageIndex !== undefined && root.PageIndex !== sequence)) return false;
    declaredTotal ??= root.Count;
    if (root.Count !== declaredTotal || page.sequence !== sequence || page.requestedPage !== sequence ||
        page.requestedPageSize !== 100 || page.declaredTotal !== root.Count) return false;

    const requestBody = { PageIndex: sequence, PageSize: 100, Category: ["1"], KeyWords: "",
      SpecialType: 0, PortalId: "", DisplayFields: config.displayFields ?? [
        "Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking", "ClassificationOne", "WorkWeChatQrCode"
      ] };
    const expectedLocator = requestContractV2Locator(beisenBaseLocator(sequence, root), {
      family: "beisen", role: "page", method: "POST", url: endpoint, body: requestBody,
      coordinate: { sequence, requestedPage: sequence, requestedPageSize: 100 }
    });
    if (artifact.requestedUrl !== endpoint || artifact.finalUrl !== endpoint ||
        artifact.extractorLocator !== expectedLocator) return false;

    const excluded = excludedByPage.get(sequence) ?? new Set<number>();
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let index = 0; index < root.Data.length; index += 1) {
      const raw = root.Data[index];
      if (!strictRecord(raw)) return false;
      if (policy === "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1") {
        if (typeof raw.Id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(raw.Id) ||
            fosunAllIds.has(raw.Id) || !exactFosunSocialRow(raw)) return false;
        fosunAllIds.add(raw.Id);
        if (excluded.has(index) !== exactFosunHongKongOnlyScope(raw)) return false;
        if (!excluded.has(index)) fosunAcceptedRows.push(raw);
      }
      if (policy === "THREESBIO_XIANYANG_HOMOGRAPH_V1" && exactThreeSbioHomograph(raw)) {
        exactHomographCorrections += 1;
      }
      const id = text(raw.Id) ?? text(raw.JobAdId);
      rawIds.push(irrevocable(id ?? raw));
      if (!excluded.has(index)) {
        const officialId = text(raw.Id);
        if (!officialId) return false;
        validIds.push(irrevocable(persistentId(officialId)));
      }
    }
    if (new Set(rawIds).size !== rawIds.length || !exactArray(page.rawJobIds, rawIds) ||
        !exactArray(page.validJobIds, validIds)) return false;
    rawCount += root.Data.length;
  }
  return declaredTotal === rawCount && exactCounts(evidence, rawCount, totalExcluded(excludedByPage)) &&
    (policy !== "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1" || exactFosunOutput(plan, fosunAcceptedRows, outputJobs)) &&
    (policy !== "THREESBIO_XIANYANG_HOMOGRAPH_V1" ||
      exactThreeSbioCorrectedOutput(outputJobs, exactHomographCorrections));
}

function replayXiuzheng(plan: OfficialPlan, evidence: PersistentSourceFetchEvidence): boolean {
  const config = plan.officialJsonFetch;
  if (config?.kind !== "xiuzheng-job-list") return false;
  const excludedByPage = exactLossIndexes(evidence, exactXiuzhengNavigation);
  if (!excludedByPage) return false;

  let rawCount = 0;
  let total: number | undefined;
  let lastPage: number | undefined;
  for (let sequence = 0; sequence < evidence.pages.length; sequence += 1) {
    const requestedPage = sequence + 1;
    const page = evidence.pages[sequence]!;
    const artifact = exactPageArtifact(evidence, page.artifactLogicalKey);
    const root = artifact && parseExactJsonRecord(artifact);
    const data = root && strictRecord(root.data) ? root.data : undefined;
    if (!artifact || !root || root.code !== 0 || !data || !Array.isArray(data.data) ||
        data.current_page !== requestedPage || data.per_page !== 10 ||
        !positiveSafeInteger(data.last_page) || !nonnegativeSafeInteger(data.total)) return false;
    total ??= data.total;
    lastPage ??= data.last_page;
    if (data.total !== total || data.last_page !== lastPage || page.sequence !== sequence ||
        page.requestedPage !== requestedPage || page.returnedPage !== requestedPage ||
        page.requestedPageSize !== 10 || page.declaredTotal !== total || page.declaredPages !== lastPage) return false;

    const expectedLocator = requestContractV2Locator(xiuzhengBaseLocator(requestedPage), {
      family: "xiuzheng", role: "page", method: "POST", url: config.endpointUrl,
      body: { page: requestedPage, pageSize: 10 },
      coordinate: { sequence, requestedPage, requestedPageSize: 10 }
    });
    if (artifact.requestedUrl !== config.endpointUrl || artifact.finalUrl !== config.endpointUrl ||
        artifact.extractorLocator !== expectedLocator) return false;

    const excluded = excludedByPage.get(sequence) ?? new Set<number>();
    const rawIds: string[] = [];
    const validIds: string[] = [];
    for (let index = 0; index < data.data.length; index += 1) {
      const raw = data.data[index];
      rawIds.push(irrevocable([index, raw]));
      if (!excluded.has(index)) {
        if (!strictRecord(raw)) return false;
        const id = officialId(raw.id);
        if (!id) return false;
        validIds.push(persistentId(id));
      }
    }
    if (!exactArray(page.rawJobIds, rawIds) || !exactArray(page.validJobIds, validIds)) return false;
    rawCount += data.data.length;
  }
  return total === rawCount && lastPage === evidence.pages.length &&
    exactCounts(evidence, rawCount, totalExcluded(excludedByPage));
}

function exactLossIndexes(
  evidence: PersistentSourceFetchEvidence,
  allowed: (raw: unknown) => boolean
): Map<number, Set<number>> | undefined {
  const byPage = new Map<number, Set<number>>();
  for (const loss of evidence.fetchLosses) {
    const sequence = loss.details.pageSequence;
    const index = loss.details.recordIndex;
    if (loss.stage !== "VALIDATION" || sequence === undefined || index === undefined ||
        !Number.isSafeInteger(sequence) || !Number.isSafeInteger(index)) return undefined;
    const page = evidence.pages[sequence];
    const artifact = page && evidence.artifacts.find((candidate) => candidate.logicalKey === page.artifactLogicalKey);
    const root = artifact && parseExactJsonRecord(artifact);
    const records = root && Array.isArray(root.Data)
      ? root.Data
      : root && strictRecord(root.data) && Array.isArray(root.data.data) ? root.data.data : undefined;
    const raw = records?.[index];
    const xiuzheng = root?.code === 0;
    const expectedCode = xiuzheng ? "NON_RECRUITMENT_CONTENT" : "OUT_OF_SCOPE";
    const expectedField = xiuzheng ? "name" : undefined;
    const expectedReason = xiuzheng
      ? `Xiuzheng record rejected: ${expectedCode}`
      : `Beisen Zhiye record rejected: ${expectedCode}`;
    const expectedLocator = `${artifact?.logicalKey}#record:${index}#${irrevocable([index, raw])}`;
    if (raw === undefined || loss.details.code !== expectedCode || loss.details.field !== expectedField ||
        loss.reason !== expectedReason || loss.rawLocator !== expectedLocator || !allowed(raw)) return undefined;
    const indexes = byPage.get(sequence) ?? new Set<number>();
    if (indexes.has(index)) return undefined;
    indexes.add(index);
    byPage.set(sequence, indexes);
  }
  return byPage;
}

function exactForeignScope(raw: unknown): boolean {
  const scope = beisenScopeValues(raw);
  if (!scope || scope.all.length === 0 || scope.all.some((value) =>
    MAINLAND_MARKER.test(value.normalize("NFKC")))) return false;
  return scope.countries.length > 0
    ? scope.countries.every((value) => EXACT_FOREIGN_COUNTRY.test(value.normalize("NFKC").trim()))
    : scope.locations.length > 0 && scope.locations.every((value) => exactForeignValue(value, ALL_FOREIGN_TERMS));
}

function exactQiluUnitedStatesOrHongKongScope(raw: unknown): boolean {
  const scope = beisenScopeValues(raw);
  if (!scope || scope.all.length === 0 || scope.all.some((value) =>
    MAINLAND_MARKER.test(value.normalize("NFKC")))) return false;
  return scope.countries.length > 0
    ? scope.countries.every((value) => EXACT_QILU_NON_MAINLAND_COUNTRY.test(value.normalize("NFKC").trim()))
    : scope.locations.length > 0 && scope.locations.every((value) =>
      exactForeignValue(value, QILU_NON_MAINLAND_TERMS));
}

function exactFosunSocialRow(raw: Record<string, unknown>): boolean {
  return typeof raw.JobAdName === "string" && raw.JobAdName.trim().length > 0 &&
    !containsSensitiveAdapterValue(raw.JobAdName) &&
    raw.Category === "社会招聘" &&
    (raw.CategoryId === undefined || raw.CategoryId === "1" || raw.CategoryId === 1) &&
    (raw.Kind === undefined || raw.Kind === null || raw.Kind === "" ||
      typeof raw.Kind === "string" && !/(?:校园|校招|campus)/iu.test(raw.Kind));
}

// Only the observed Hong Kong-only vocabulary is admitted for this source. All
// populated country/alternate location labels must agree; shadow fields cannot
// hide mainland, mixed, malformed or unknown geography behind LocNames.
function exactFosunHongKongOnlyScope(raw: unknown): boolean {
  if (!strictRecord(raw) || !Array.isArray(raw.LocNames) || raw.LocNames.length === 0) return false;
  const hongKong = (value: unknown) => typeof value === "string" &&
    /^(?:香港(?:特别行政区)?|hong kong(?: special administrative region| sar)?)$/iu.test(value.normalize("NFKC").trim());
  return raw.LocNames.every(hongKong) &&
    [raw.Country, raw.CountryName, raw.LocName, raw.LocationName, raw.City].every(value =>
      value === undefined || value === null || value === "" || hongKong(value));
}

function exactFosunOutput(
  plan: OfficialPlan,
  rows: readonly Record<string, unknown>[],
  jobs: readonly NormalizedJobRecord[]
): boolean {
  if (jobs.length !== rows.length || new Set(jobs.map(job => job.sourceJobId)).size !== jobs.length) return false;
  const byId = new Map(jobs.map(job => [job.sourceJobId, job]));
  const cleaned = (value: string) => value.replace(/\s+/gu, " ").trim();
  return rows.every(raw => {
    if (typeof raw.Id !== "string" || typeof raw.JobAdName !== "string" ||
        !Array.isArray(raw.LocNames) || raw.LocNames.length === 0 ||
        !raw.LocNames.every(value => typeof value === "string" && value.trim())) return false;
    if (!hasExactFosunMainlandGeography(raw)) return false;
    const parts = (raw.LocNames as string[]).map(value => value.trim());
    const cities = mainlandDisplayCities(parts);
    const job = byId.get(persistentId(raw.Id));
    const url = new URL("/social/detail", plan.source.officialEntryUrl);
    url.searchParams.set("jobAdId", raw.Id);
    return job !== undefined && job.companyId === plan.company.id && job.sourceId === plan.source.id &&
      job.sourceKind === "SOCIAL" && job.atsKind === "BEISEN_ZHIYE" &&
      job.officialTitle === cleaned(raw.JobAdName) && job.officialUrl === url.toString() &&
      job.locationRaw === cleaned(parts.join(" / ")) && exactArray(job.cities, cities);
  });
}

function exactJapanScope(raw: unknown): boolean {
  const scope = beisenScopeValues(raw);
  if (!scope || scope.all.length === 0 || scope.all.some((value) =>
    MAINLAND_MARKER.test(value.normalize("NFKC")))) return false;
  return scope.countries.length > 0
    ? scope.countries.every((value) => EXACT_JAPAN_COUNTRY.test(value.normalize("NFKC").trim()))
    : scope.locations.length > 0 && scope.locations.every((value) => exactForeignValue(value, JAPAN_TERMS));
}

function beisenScopeValues(raw: unknown):
  { countries: string[]; locations: string[]; all: string[] } | undefined {
  if (!strictRecord(raw)) return undefined;
  const countries: string[] = [];
  for (const value of [raw.Country, raw.CountryName]) {
    const normalized = strictText(value);
    if (normalized === null) return undefined;
    if (normalized) countries.push(normalized);
  }
  const locations: string[] = [];
  const locNames = strictTextArray(raw.LocNames);
  if (locNames === undefined) return undefined;
  if (locNames.length > 0) locations.push(...locNames);
  else {
    for (const value of [raw.LocName, raw.LocationName, raw.City]) {
      const normalized = strictText(value);
      if (normalized === null) return undefined;
      if (normalized) { locations.push(normalized); break; }
    }
  }
  return { countries, locations, all: [...countries, ...locations] };
}

function exactXiuzhengNavigation(raw: unknown): boolean {
  return strictRecord(raw) && typeof raw.name === "string" && raw.name.trim() === "用人理念";
}

function exactThreeSbioHomograph(raw: unknown): boolean {
  return strictRecord(raw) &&
    raw.Id === "3074600c-a1bb-4f66-80e4-93f08a71bf44" &&
    raw.JobAdName === "(高级)医学信息沟通专员-TBU专岗-(咸阳)(J16744)" &&
    Array.isArray(raw.LocNames) && raw.LocNames.length === 1 &&
    raw.LocNames[0] === "韩国·庆尚南道·咸阳郡" &&
    raw.Country === undefined && raw.CountryName === undefined;
}

function exactThreeSbioCorrectedOutput(
  outputJobs: readonly NormalizedJobRecord[],
  exactHomographCorrections: number
): boolean {
  if (exactHomographCorrections > 1) return false;
  const exactSourceJobId = persistentId("3074600c-a1bb-4f66-80e4-93f08a71bf44");
  const matching = outputJobs.filter((job) =>
    job.sourceId === "source-3sbio-social" && job.sourceJobId === exactSourceJobId);
  if (exactHomographCorrections === 0) return matching.length === 0;
  return matching.length === 1 &&
    matching[0]!.officialTitle === "(高级)医学信息沟通专员-TBU专岗-(咸阳)(J16744)" &&
    matching[0]!.locationRaw === "咸阳" && exactArray(matching[0]!.cities, ["咸阳"]);
}

const MAINLAND_MARKER = /(?:中华人民共和国|中国大陆|中国|大陆|china|prc|mainland|北京|上海|天津|重庆|广东|浙江|江苏|山东|四川|福建|湖北|湖南|河南|河北|安徽|江西|陕西|山西|辽宁|吉林|黑龙江|广西|海南|贵州|云南|甘肃|青海|宁夏|新疆|西藏|内蒙古|深圳|广州|杭州|南京|苏州|武汉|成都|西安)/iu;
const EXACT_FOREIGN_COUNTRY = /^(?:united states|usa|u\.s\.?|singapore|japan|india|germany|france|canada|australia|united kingdom|u\.k\.?|south korea|republic of korea|hong kong|macau|macao|taiwan|美国|新加坡|日本|印度|德国|法国|加拿大|澳大利亚|英国|韩国|香港|澳门|台湾)$/iu;
const EXACT_QILU_NON_MAINLAND_COUNTRY = /^(?:united states|usa|u\.s\.?|hong kong|美国|香港)$/iu;
const EXACT_JAPAN_COUNTRY = /^(?:japan|日本)$/iu;
const ALL_FOREIGN_TERMS = /(?:united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|singapore|japan|tokyo|osaka|kyoto|india|germany|france|canada|australia|united kingdom|u\.k\.|london|south korea|republic of korea|seoul|hong kong|macau|macao|taiwan|overseas|abroad|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|新加坡|日本|东京|大阪|京都|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|首尔|香港|澳门|台湾|海外|国外)/giu;
const QILU_NON_MAINLAND_TERMS = /(?:united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|hong kong|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|香港)/giu;
const JAPAN_TERMS = /(?:japan|tokyo|osaka|kyoto|yokohama|nagoya|kobe|fukuoka|日本|东京|東京|大阪|京都|横滨|横浜|名古屋|神户|神戸|福冈|福岡)/giu;

function exactForeignValue(value: string, terms: RegExp): boolean {
  terms.lastIndex = 0;
  if (!terms.test(value)) return false;
  terms.lastIndex = 0;
  const residue = value.normalize("NFKC").toLowerCase()
    .replace(terms, "")
    .replace(/(?:special administrative region|state|province|city|county|district|sar|特别行政区|自治区|省|州|市|县|区|郡)/giu, "")
    .replace(/[\s,，/|;；、()（）.·_-]+/gu, "");
  return residue.length === 0;
}

function exactPageArtifact(
  evidence: PersistentSourceFetchEvidence,
  logicalKey: string
): SourceFetchArtifactDraft | undefined {
  const matches = evidence.artifacts.filter((artifact) => artifact.logicalKey === logicalKey);
  const artifact = matches.length === 1 ? matches[0] : undefined;
  return artifact && artifact.kind === "PAGINATION_PAGE" && artifact.httpStatus === 200 &&
    artifact.bodyRepresentation === "EXACT" && artifact.rawBodySha256 === undefined &&
    artifact.redactionDescriptors === undefined && typeof artifact.body === "string"
    ? artifact
    : undefined;
}

function parseExactJsonRecord(artifact: SourceFetchArtifactDraft): Record<string, unknown> | undefined {
  if (typeof artifact.body !== "string" || !hasUniqueJsonObjectKeys(artifact.body)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(artifact.body); } catch { return undefined; }
  return strictRecord(parsed) ? parsed : undefined;
}

function beisenBaseLocator(sequence: number, root: Record<string, unknown>): string {
  return [
    "beisen-zhiye-page-v1",
    `requestPageIndex:${sequence}`,
    "requestPageSize:100",
    `requestCategory:${irrevocable("1")}`,
    `json:${Object.prototype.hasOwnProperty.call(root, "Count") ? "$.Count," : ""}$.Data`
  ].join("|");
}

function xiuzhengBaseLocator(page: number): string {
  return `xiuzheng-job-list-v1|request:page=${page},pageSize=10|json:$.code,$.data.current_page,$.data.last_page,$.data.total,$.data.per_page,$.data.data[*]`;
}

function exactCounts(evidence: PersistentSourceFetchEvidence, rawCount: number, excluded: number): boolean {
  return evidence.fetchCounts.rawCount === rawCount && evidence.fetchCounts.parsedCount === rawCount &&
    evidence.fetchCounts.validCount === rawCount - excluded && evidence.fetchCounts.parseDiscardCount === 0 &&
    evidence.fetchCounts.validationDiscardCount === excluded && evidence.fetchLosses.length === excluded;
}

function totalExcluded(values: ReadonlyMap<number, ReadonlySet<number>>): number {
  return [...values.values()].reduce((total, indexes) => total + indexes.size, 0);
}

function strictRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function strictText(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strictTextArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  const values: string[] = [];
  for (const item of raw) {
    const normalized = strictText(item);
    if (normalized === null) return undefined;
    if (normalized) values.push(normalized);
  }
  return values;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() :
    typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
}

function officialId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(Buffer.from(JSON.stringify(value), "utf8")).digest("hex");
}

function irrevocable(value: unknown): string {
  return `sha256:${hashValue(value)}`;
}

function persistentId(value: string): string {
  return `official-json:sha256:${hashValue(value)}`;
}

function exactArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return nonnegativeSafeInteger(value) && value > 0;
}
