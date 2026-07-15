import { createHash } from "node:crypto";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { NormalizedJobRecord } from "./normalizedJob";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import { requestContractV2Locator } from "./strictPageRequestContract";

type OfficialPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;
type ProofPolicy =
  | "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
  | "QILU_EXPLICIT_US_ONLY_V1"
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
  QILU_EXPLICIT_US_ONLY_V1: {
    policy: "QILU_EXPLICIT_US_ONLY_V1",
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
  const expectedDetailPath = policy === "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
    ? "Social/detail"
    : "social/detail";
  return config?.kind === "beisen-zhiye-2022" && config.scopeExclusionProof === policy &&
    config.geographyScope === "DOMESTIC_OFFICIAL_TENANT" && config.category === "1" &&
    config.pageSize === 100 && config.maxPages === 5 && config.detailPath === expectedDetailPath &&
    config.mixedLocationPolicy === undefined;
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
    policy === "QILU_EXPLICIT_US_ONLY_V1"
      ? exactUnitedStatesScope(raw)
      : policy === "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
        ? exactForeignScope(raw)
        : false);
  if (!excludedByPage) return false;

  let rawCount = 0;
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

function exactUnitedStatesScope(raw: unknown): boolean {
  const scope = beisenScopeValues(raw);
  if (!scope || scope.all.length === 0 || scope.all.some((value) =>
    MAINLAND_MARKER.test(value.normalize("NFKC")))) return false;
  return scope.countries.length > 0
    ? scope.countries.every((value) => EXACT_US_COUNTRY.test(value.normalize("NFKC").trim()))
    : scope.locations.length > 0 && scope.locations.every((value) => exactForeignValue(value, US_TERMS));
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
const EXACT_US_COUNTRY = /^(?:united states|usa|u\.s\.?|美国)$/iu;
const ALL_FOREIGN_TERMS = /(?:united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|singapore|japan|tokyo|osaka|kyoto|india|germany|france|canada|australia|united kingdom|u\.k\.|london|south korea|republic of korea|seoul|hong kong|macau|macao|taiwan|overseas|abroad|美国|纽约|波士顿|旧金山|洛杉矶|西雅图|新加坡|日本|东京|大阪|京都|印度|德国|法国|加拿大|澳大利亚|英国|伦敦|韩国|首尔|香港|澳门|台湾|海外|国外)/giu;
const US_TERMS = /(?:united states|usa|u\.s\.|boston|new york|san francisco|los angeles|seattle|美国|纽约|波士顿|旧金山|洛杉矶|西雅图)/giu;

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
