import { createHash } from "node:crypto";
import { candidateCompanies, CONFIRMED_V3_TO_RUNTIME_COMPANY_ID } from "./companyRegistry";

export const OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION =
  "phase2-task2-canonical-candidate-v1" as const;
export type ResearchBatchId = "F01" | "F02" | "D01" | "D02";
export type CandidateCategory = "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
export type CandidateSurfaceKind = "SOCIAL" | "CAMPUS" | "INTERNAL" | "EXCLUDED";
export type CandidateSurfaceStatus = "PENDING" | "BLOCKED" | "EXCLUDED";
export type CandidateChannelStatus = "PENDING" | "UNRESOLVED";
export type CandidateChannelKind = "SOCIAL" | "CAMPUS" | "INTERNAL" | "UNKNOWN";
export type CandidateOracleStatus = "RESEARCH_PENDING_INDEPENDENT_VERIFICATION";
export type CandidateAtsKind =
  | "UNKNOWN" | "OFFICIAL_HTML" | "OFFICIAL_JSON" | "WORKDAY" | "PHENOM" | "MOKA"
  | "ZHIYE" | "REDSEA" | "HOTJOB_WECRUIT" | "SUCCESSFACTORS" | "OTHER";

export type CandidateScope =
  | { status: "RESOLVED"; value: string }
  | { status: "UNRESOLVED"; reason: string };

export interface CandidateEvidenceRecord {
  evidenceId: string;
  url: string;
  sourceRole: "COMPANY_OFFICIAL_PAGE" | "CAREERS_OFFICIAL_PAGE" | "OFFICIAL_REDIRECT" | "ATS_FINAL" | "OFFICIAL_API_METADATA";
  capturedAt: string;
  httpStatus: number;
  finalUrl: string;
  fact: string;
}

export interface CandidateOfficialDomainProvenance {
  websiteUrl: string;
  confirmedHost: string;
  evidenceId: string;
}

export interface CandidateOfficialChainHop {
  hopId: string;
  evidenceId: string;
  evidenceSha256: string;
  fromUrl: string;
  fromRole: CandidateEvidenceRecord["sourceRole"];
  toUrl: string;
  toRole: CandidateEvidenceRecord["sourceRole"];
  mechanism: "LINK" | "REDIRECT";
}

export interface CandidateChannel {
  channelId: string;
  kind: CandidateChannelKind;
  discoveryStatus: CandidateChannelStatus;
}

export interface CandidateSurface {
  surfaceId: string;
  kind: CandidateSurfaceKind;
  candidateStatus: CandidateSurfaceStatus;
  officialEntryUrl: string | null;
  finalUrl: string | null;
  entryHopId: string | null;
  officialChainEvidence: CandidateEvidenceRecord[];
  officialChainHops: CandidateOfficialChainHop[];
  legalEntityScope: CandidateScope[];
  businessUnitScope: CandidateScope[];
  brandScope: CandidateScope[];
  chinaScope: CandidateScope;
  ats: { kind: CandidateAtsKind; tenant: CandidateScope };
  channels: CandidateChannel[];
}

export interface CandidateUnresolvedRisk {
  code: string;
  detail: string;
  followUp: string;
}

export interface OfficialSourceResearchCandidateCompany {
  confirmedV3Id: string;
  runtimeId: string;
  ordinal: number;
  category: CandidateCategory;
  officialChineseName: string;
  globalName: string;
  officialWebsiteUrls: string[];
  officialDomainProvenance: CandidateOfficialDomainProvenance[];
  surfaces: CandidateSurface[];
  unresolvedRisks: CandidateUnresolvedRisk[];
}

export interface OfficialSourceResearchCandidateBatch {
  schemaVersion: typeof OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION;
  batchId: ResearchBatchId;
  captureStartedAt: string;
  captureCompletedAt: string;
  discoveryOnly: true;
  oracleStatus: CandidateOracleStatus;
  promotionCount: 0;
  companies: OfficialSourceResearchCandidateCompany[];
}

export interface MergedOfficialSourceResearchCandidates {
  schemaVersion: typeof OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION;
  batchIds: ResearchBatchId[];
  discoveryOnly: true;
  oracleStatus: CandidateOracleStatus;
  promotionCount: 0;
  companies: OfficialSourceResearchCandidateCompany[];
  sha256: string;
}

const ALL_CONFIRMED_IDS = Object.keys(CONFIRMED_V3_TO_RUNTIME_COMPANY_ID);
const EXPECTED_PARTITIONS: Record<ResearchBatchId, readonly string[]> = {
  F01: ALL_CONFIRMED_IDS.slice(0, 15),
  F02: ALL_CONFIRMED_IDS.slice(15, 30),
  D01: ALL_CONFIRMED_IDS.slice(30, 45),
  D02: ALL_CONFIRMED_IDS.slice(45, 60)
};
const EXPECTED_ORDINAL_START: Record<ResearchBatchId, number> = {
  F01: 1, F02: 16, D01: 1, D02: 16
};
const OFFICIAL_BACKLINK_ROLES = new Set(["COMPANY_OFFICIAL_PAGE", "CAREERS_OFFICIAL_PAGE", "OFFICIAL_REDIRECT"]);
const EXTERNAL_ATS_KINDS = new Set(["WORKDAY", "PHENOM", "MOKA", "ZHIYE", "REDSEA", "HOTJOB_WECRUIT", "SUCCESSFACTORS"]);
const ATS_KINDS = [
  "UNKNOWN", "OFFICIAL_HTML", "OFFICIAL_JSON", "WORKDAY", "PHENOM", "MOKA", "ZHIYE",
  "REDSEA", "HOTJOB_WECRUIT", "SUCCESSFACTORS", "OTHER"
] as const;
const EXTERNAL_ATS_HOST_SUFFIXES: Partial<Record<CandidateAtsKind, readonly string[]>> = {
  WORKDAY: ["myworkdayjobs.com", "myworkday.com"],
  PHENOM: ["phenompeople.com"],
  MOKA: ["mokahr.com"],
  ZHIYE: ["zhiye.com"],
  REDSEA: ["redsea.com.cn"],
  HOTJOB_WECRUIT: ["hotjob.cn"],
  SUCCESSFACTORS: ["successfactors.com", "successfactors.eu"]
};
const DENIED_OFFICIAL_HOSTS = [
  "google.com", "bing.com", "tavily.com", "linkedin.com", "indeed.com", "glassdoor.com",
  "liepin.com", "zhaopin.com", "51job.com", "bosszhipin.com"
] as const;

export function parseOfficialSourceResearchCandidateBatch(
  value: unknown,
  now = new Date()
): OfficialSourceResearchCandidateBatch {
  const root = exactObject(value, [
    "schemaVersion", "batchId", "captureStartedAt", "captureCompletedAt", "discoveryOnly",
    "oracleStatus", "promotionCount", "companies"
  ], "batch");
  if (root.schemaVersion !== OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION) invalid("schemaVersion");
  if (!isOneOf(root.batchId, ["F01", "F02", "D01", "D02"] as const)) invalid("batchId");
  const batchId = root.batchId as ResearchBatchId;
  const started = strictIso(root.captureStartedAt, "captureStartedAt", now);
  const completed = strictIso(root.captureCompletedAt, "captureCompletedAt", now);
  if (started.getTime() > completed.getTime()) invalid("capture order");
  if (root.discoveryOnly !== true) invalid("discoveryOnly");
  if (root.oracleStatus !== "RESEARCH_PENDING_INDEPENDENT_VERIFICATION") invalid("oracleStatus");
  if (root.promotionCount !== 0) invalid("promotionCount");
  if (!Array.isArray(root.companies)) invalid("companies");
  const captureWindow = { started, completed };
  const companies = root.companies.map((company, index) => parseCompany(company, batchId, index, now, captureWindow));
  unique(companies.flatMap((company) => company.surfaces.flatMap((surface) =>
    surface.officialChainEvidence.map((evidence) => evidence.evidenceId))), "batch evidenceId");
  unique(companies.flatMap((company) => company.surfaces.flatMap((surface) =>
    surface.officialChainHops.map((hop) => hop.hopId))), "batch hopId");
  validateExactPartition(companies, batchId);
  return {
    schemaVersion: OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION,
    batchId,
    captureStartedAt: root.captureStartedAt as string,
    captureCompletedAt: root.captureCompletedAt as string,
    discoveryOnly: true,
    oracleStatus: "RESEARCH_PENDING_INDEPENDENT_VERIFICATION",
    promotionCount: 0,
    companies
  };
}

function parseCompany(value: unknown, batchId: ResearchBatchId, index: number, now: Date,
  captureWindow: { started: Date; completed: Date }): OfficialSourceResearchCandidateCompany {
  const row = exactObject(value, [
    "confirmedV3Id", "runtimeId", "ordinal", "category", "officialChineseName", "globalName",
    "officialWebsiteUrls", "officialDomainProvenance", "surfaces", "unresolvedRisks"
  ], `company[${index}]`);
  const confirmedV3Id = nonblank(row.confirmedV3Id, "confirmedV3Id");
  const expectedRuntimeId = CONFIRMED_V3_TO_RUNTIME_COMPANY_ID[confirmedV3Id];
  if (!expectedRuntimeId || row.runtimeId !== expectedRuntimeId) invalid("runtimeId mapping");
  const registryCompany = candidateCompanies.find((company) => company.id === expectedRuntimeId);
  if (!registryCompany || row.officialChineseName !== registryCompany.officialChineseName) invalid("officialChineseName mapping");
  const ordinal = integer(row.ordinal, "ordinal");
  if (ordinal !== EXPECTED_ORDINAL_START[batchId] + index) invalid("ordinal");
  const expectedCategory = batchId.startsWith("F") ? "FOREIGN_PHARMA" : "DOMESTIC_PHARMA";
  if (row.category !== expectedCategory) invalid("category");
  if (!Array.isArray(row.officialWebsiteUrls) || row.officialWebsiteUrls.length === 0) invalid("officialWebsiteUrls");
  const officialWebsiteUrls = unique(row.officialWebsiteUrls.map((url) => safeHttps(url, "officialWebsiteUrl")), "officialWebsiteUrls");
  const confirmedOfficialUrl = registryCompany.officialWebsiteUrl;
  if (!confirmedOfficialUrl) invalid("confirmed official host");
  const confirmedHost = new URL(confirmedOfficialUrl).hostname.toLowerCase();
  for (const websiteUrl of officialWebsiteUrls) {
    const host = new URL(websiteUrl).hostname.toLowerCase();
    if (isDeniedOfficialHost(host) || !isSameOrSubdomain(host, confirmedHost)) invalid("officialWebsiteUrls provenance");
  }
  if (!Array.isArray(row.officialDomainProvenance)) invalid("officialDomainProvenance");
  const officialDomainProvenance = row.officialDomainProvenance.map((item, provenanceIndex) => {
    const provenance = exactObject(item, ["websiteUrl", "confirmedHost", "evidenceId"], `officialDomainProvenance[${provenanceIndex}]`);
    const websiteUrl = safeHttps(provenance.websiteUrl, "provenance.websiteUrl");
    if (!officialWebsiteUrls.includes(websiteUrl) || provenance.confirmedHost !== confirmedHost) invalid("officialDomainProvenance binding");
    return { websiteUrl, confirmedHost, evidenceId: nonblank(provenance.evidenceId, "provenance.evidenceId") };
  });
  if (officialDomainProvenance.length !== officialWebsiteUrls.length ||
      new Set(officialDomainProvenance.map((item) => item.websiteUrl)).size !== officialWebsiteUrls.length) invalid("officialDomainProvenance coverage");
  if (!Array.isArray(row.surfaces) || row.surfaces.length === 0) invalid("surfaces");
  const surfaces = row.surfaces.map((surface, surfaceIndex) =>
    parseSurface(surface, surfaceIndex, now, officialWebsiteUrls, captureWindow, confirmedV3Id));
  unique(surfaces.map((surface) => surface.surfaceId), "surfaceId");
  if (!Array.isArray(row.unresolvedRisks) || row.unresolvedRisks.length === 0) invalid("unresolvedRisks");
  const unresolvedRisks = row.unresolvedRisks.map((risk, riskIndex) => parseRisk(risk, riskIndex));
  const allEvidence = surfaces.flatMap((surface) => surface.officialChainEvidence);
  unique(allEvidence.map((evidence) => evidence.evidenceId), "company evidenceId");
  unique(surfaces.flatMap((surface) => surface.officialChainHops.map((hop) => hop.hopId)), "company hopId");
  const evidenceById = new Map(allEvidence.map((evidence) => [evidence.evidenceId, evidence]));
  for (const provenance of officialDomainProvenance) {
    const evidence = evidenceById.get(provenance.evidenceId);
    if (!evidence || evidence.sourceRole !== "COMPANY_OFFICIAL_PAGE" ||
        new URL(evidence.url).hostname.toLowerCase() !== new URL(provenance.websiteUrl).hostname.toLowerCase()) {
      invalid("officialDomainProvenance evidence");
    }
  }
  return {
    confirmedV3Id, runtimeId: expectedRuntimeId, ordinal, category: expectedCategory,
    officialChineseName: nonblank(row.officialChineseName, "officialChineseName"),
    globalName: nonblank(row.globalName, "globalName"), officialWebsiteUrls, officialDomainProvenance, surfaces, unresolvedRisks
  };
}

function parseSurface(value: unknown, index: number, now: Date, officialWebsiteUrls: readonly string[],
  captureWindow: { started: Date; completed: Date }, confirmedV3Id: string): CandidateSurface {
  const row = exactObject(value, [
    "surfaceId", "kind", "candidateStatus", "officialEntryUrl", "finalUrl", "entryHopId", "officialChainEvidence", "officialChainHops",
    "legalEntityScope", "businessUnitScope", "brandScope", "chinaScope", "ats", "channels"
  ], `surface[${index}]`);
  if (!isOneOf(row.kind, ["SOCIAL", "CAMPUS", "INTERNAL", "EXCLUDED"] as const)) invalid("surface kind");
  if (!isOneOf(row.candidateStatus, ["PENDING", "BLOCKED", "EXCLUDED"] as const)) invalid("candidateStatus");
  const officialEntryUrl = nullableHttps(row.officialEntryUrl, "officialEntryUrl");
  const finalUrl = nullableHttps(row.finalUrl, "finalUrl");
  const entryHopId = row.entryHopId === null ? null : nonblank(row.entryHopId, "entryHopId");
  if (!Array.isArray(row.officialChainEvidence)) invalid("officialChainEvidence");
  const officialChainEvidence = row.officialChainEvidence.map((record, evidenceIndex) =>
    parseEvidence(record, evidenceIndex, now, captureWindow));
  unique(officialChainEvidence.map((record) => record.evidenceId), "evidenceId");
  if (officialEntryUrl !== null && officialChainEvidence.length === 0) invalid("officialChainEvidence");
  if (!Array.isArray(row.officialChainHops)) invalid("officialChainHops");
  const officialChainHops = row.officialChainHops.map((hop, hopIndex) => parseChainHop(hop, hopIndex, officialChainEvidence));
  unique(officialChainHops.map((hop) => hop.hopId), "hopId");
  const legalEntityScope = parseScopeArray(row.legalEntityScope, "legalEntityScope");
  const businessUnitScope = parseScopeArray(row.businessUnitScope, "businessUnitScope");
  const brandScope = parseScopeArray(row.brandScope, "brandScope");
  const chinaScope = parseScope(row.chinaScope, "chinaScope");
  const atsRow = exactObject(row.ats, ["kind", "tenant"], "ats");
  if (!isOneOf(atsRow.kind, ATS_KINDS)) invalid("ats.kind");
  const ats = { kind: atsRow.kind, tenant: parseScope(atsRow.tenant, "ats.tenant") };
  if (!Array.isArray(row.channels) || row.channels.length === 0) invalid("channels");
  const channels = row.channels.map((channel, channelIndex) => parseChannel(channel, channelIndex));
  unique(channels.map((channel) => channel.channelId), "channelId");
  const officialHosts = new Set(officialWebsiteUrls.map((url) => new URL(url).hostname));
  validateChain(officialChainHops, officialHosts, officialEntryUrl, finalUrl, entryHopId, EXTERNAL_ATS_KINDS.has(ats.kind));
  if (EXTERNAL_ATS_KINDS.has(ats.kind) && officialEntryUrl !== null) {
    const atsUrl = new URL(finalUrl ?? officialEntryUrl);
    const host = atsUrl.hostname.toLowerCase();
    const standardHost = (EXTERNAL_ATS_HOST_SUFFIXES[ats.kind] ?? []).some((suffix) => isSameOrSubdomain(host, suffix));
    if (!standardHost && !isExactCspcRedseaDeployment(confirmedV3Id, ats.kind, atsUrl)) invalid("ATS kind host");
  }
  return {
    surfaceId: nonblank(row.surfaceId, "surfaceId"), kind: row.kind as CandidateSurfaceKind,
    candidateStatus: row.candidateStatus as CandidateSurfaceStatus, officialEntryUrl, finalUrl, entryHopId,
    officialChainEvidence, officialChainHops, legalEntityScope, businessUnitScope, brandScope, chinaScope, ats, channels
  };
}

function isExactCspcRedseaDeployment(confirmedV3Id: string, atsKind: CandidateAtsKind, url: URL): boolean {
  if (confirmedV3Id !== "domestic-cspc" || atsKind !== "REDSEA" || url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "ehr.e-cspc.com" || url.port !== "8081" || url.search !== "" || url.hash !== "") return false;
  const rawPath = url.pathname;
  let decodedPath = rawPath;
  const maxDecodePasses = 4;
  for (let pass = 0; pass < maxDecodePasses; pass += 1) {
    decodedPath = decodedPath.normalize("NFKC");
    if (/%(?:2e|2f|5c)/iu.test(decodedPath) || /%(?![0-9a-f]{2})/iu.test(decodedPath) ||
        /[\u0000-\u001f\u007f-\u009f\u2044\u2215\u29f8\uff0f\uff3c\\]/u.test(decodedPath)) return false;
    let next: string;
    try { next = decodeURIComponent(decodedPath); } catch { return false; }
    if (next === decodedPath) break;
    decodedPath = next;
  }
  decodedPath = decodedPath.normalize("NFKC");
  if (decodedPath.includes("%") || /[\u0000-\u001f\u007f-\u009f\u2044\u2215\u29f8\uff0f\uff3c\\]/u.test(decodedPath) ||
      decodedPath.split("/").some((segment) => segment === "." || segment === "..")) return false;
  if (!(decodedPath === "/RedseaPlatform" || decodedPath.startsWith("/RedseaPlatform/"))) return false;
  return url.href === `https://ehr.e-cspc.com:8081${decodedPath}`;
}

function parseEvidence(value: unknown, index: number, now: Date,
  captureWindow: { started: Date; completed: Date }): CandidateEvidenceRecord {
  const row = exactObject(value, ["evidenceId", "url", "sourceRole", "capturedAt", "httpStatus", "finalUrl", "fact"], `evidence[${index}]`);
  if (!isOneOf(row.sourceRole, ["COMPANY_OFFICIAL_PAGE", "CAREERS_OFFICIAL_PAGE", "OFFICIAL_REDIRECT", "ATS_FINAL", "OFFICIAL_API_METADATA"] as const)) invalid("sourceRole");
  const capturedAt = strictIso(row.capturedAt, "evidence.capturedAt", now);
  if (capturedAt < captureWindow.started || capturedAt > captureWindow.completed) invalid("evidence capture window");
  const httpStatus = integer(row.httpStatus, "httpStatus");
  if (httpStatus < 100 || httpStatus > 599) invalid("httpStatus");
  const url = safeHttps(row.url, "evidence.url");
  if (isDeniedOfficialHost(new URL(url).hostname.toLowerCase())) {
    invalid("official evidence host");
  }
  return {
    evidenceId: nonblank(row.evidenceId, "evidenceId"), url, sourceRole: row.sourceRole as CandidateEvidenceRecord["sourceRole"],
    capturedAt: row.capturedAt as string, httpStatus, finalUrl: safeHttps(row.finalUrl, "evidence.finalUrl"),
    fact: nonblank(row.fact, "evidence.fact")
  };
}

function parseChainHop(value: unknown, index: number, evidenceRecords: readonly CandidateEvidenceRecord[]): CandidateOfficialChainHop {
  const row = exactObject(value, ["hopId", "evidenceId", "evidenceSha256", "fromUrl", "fromRole", "toUrl", "toRole", "mechanism"], `hop[${index}]`);
  if (!isOneOf(row.fromRole, ["COMPANY_OFFICIAL_PAGE", "CAREERS_OFFICIAL_PAGE", "OFFICIAL_REDIRECT", "ATS_FINAL", "OFFICIAL_API_METADATA"] as const) ||
      !isOneOf(row.toRole, ["COMPANY_OFFICIAL_PAGE", "CAREERS_OFFICIAL_PAGE", "OFFICIAL_REDIRECT", "ATS_FINAL", "OFFICIAL_API_METADATA"] as const)) invalid("hop role");
  if (!isOneOf(row.mechanism, ["LINK", "REDIRECT"] as const)) invalid("hop mechanism");
  if (!validHopTransition(row.fromRole, row.toRole, row.mechanism)) invalid("hop transition");
  const evidenceId = nonblank(row.evidenceId, "hop.evidenceId");
  const evidence = evidenceRecords.find((item) => item.evidenceId === evidenceId);
  const fromUrl = safeHttps(row.fromUrl, "hop.fromUrl");
  const toUrl = safeHttps(row.toUrl, "hop.toUrl");
  const evidenceSha256 = nonblank(row.evidenceSha256, "hop.evidenceSha256");
  if (!evidence || evidenceSha256 !== canonicalEvidenceRecordHash(evidence) || evidence.url !== fromUrl ||
      evidence.finalUrl !== toUrl || evidence.sourceRole !== row.fromRole) invalid("hop evidence binding");
  return { hopId: nonblank(row.hopId, "hopId"), evidenceId, evidenceSha256, fromUrl,
    fromRole: row.fromRole, toUrl, toRole: row.toRole, mechanism: row.mechanism };
}

function validateChain(hops: readonly CandidateOfficialChainHop[], officialHosts: ReadonlySet<string>,
  officialEntryUrl: string | null, finalUrl: string | null, entryHopId: string | null, externalAts: boolean): void {
  if (officialEntryUrl === null) {
    if (hops.length !== 0 || entryHopId !== null || finalUrl !== null) invalid("chain without entry");
    return;
  }
  if (hops.length === 0 || entryHopId === null) invalid("official chain");
  const first = hops[0]!;
  if (!officialHosts.has(new URL(first.fromUrl).hostname) || !OFFICIAL_BACKLINK_ROLES.has(first.fromRole)) invalid("chain origin");
  for (let index = 1; index < hops.length; index += 1) {
    const previous = hops[index - 1]!;
    const current = hops[index]!;
    if (previous.toUrl !== current.fromUrl || previous.toRole !== current.fromRole) invalid("chain continuity");
  }
  const last = hops[hops.length - 1]!;
  const expectedFinal = finalUrl ?? officialEntryUrl;
  const entryHop = hops.find((hop) => hop.hopId === entryHopId);
  if (!entryHop || entryHop.toUrl !== officialEntryUrl) invalid("chain entry binding");
  const entryHost = new URL(officialEntryUrl).hostname;
  if (!officialHosts.has(entryHost)) {
    const firstExternalHop = hops.find((hop) => !officialHosts.has(new URL(hop.toUrl).hostname));
    if (firstExternalHop?.hopId !== entryHopId) invalid("chain first external entry");
  }
  if (last.toUrl !== expectedFinal) invalid("chain terminal");
  if (externalAts && last.toRole !== "ATS_FINAL") invalid("ATS chain terminal role");
}

function validHopTransition(fromRole: CandidateEvidenceRecord["sourceRole"], toRole: CandidateEvidenceRecord["sourceRole"],
  mechanism: CandidateOfficialChainHop["mechanism"]): boolean {
  if (mechanism === "REDIRECT") {
    return fromRole === "OFFICIAL_REDIRECT" &&
      ["OFFICIAL_REDIRECT", "CAREERS_OFFICIAL_PAGE", "ATS_FINAL", "OFFICIAL_API_METADATA"].includes(toRole);
  }
  if (fromRole === "OFFICIAL_REDIRECT" || fromRole === "ATS_FINAL") return false;
  const allowed: Partial<Record<CandidateEvidenceRecord["sourceRole"], readonly CandidateEvidenceRecord["sourceRole"][]>> = {
    COMPANY_OFFICIAL_PAGE: ["CAREERS_OFFICIAL_PAGE", "OFFICIAL_REDIRECT", "ATS_FINAL"],
    CAREERS_OFFICIAL_PAGE: ["OFFICIAL_REDIRECT", "ATS_FINAL", "OFFICIAL_API_METADATA"],
    OFFICIAL_API_METADATA: ["ATS_FINAL"]
  };
  return (allowed[fromRole] ?? []).includes(toRole);
}

export function canonicalEvidenceRecordHash(evidence: CandidateEvidenceRecord): string {
  return createHash("sha256").update(canonicalJson(evidence), "utf8").digest("hex");
}

function parseScopeArray(value: unknown, field: string): CandidateScope[] {
  if (!Array.isArray(value) || value.length === 0) invalid(field);
  return value.map((scope, index) => parseScope(scope, `${field}[${index}]`));
}

function parseScope(value: unknown, field: string): CandidateScope {
  if (!isRecord(value)) invalid(field);
  if (value.status === "RESOLVED") {
    const row = exactObject(value, ["status", "value"], field);
    return { status: "RESOLVED", value: nonblank(row.value, `${field}.value`) };
  }
  if (value.status === "UNRESOLVED") {
    const row = exactObject(value, ["status", "reason"], field);
    return { status: "UNRESOLVED", reason: nonblank(row.reason, `${field}.reason`) };
  }
  invalid(field);
}

function parseChannel(value: unknown, index: number): CandidateChannel {
  const row = exactObject(value, ["channelId", "kind", "discoveryStatus"], `channel[${index}]`);
  if (!isOneOf(row.kind, ["SOCIAL", "CAMPUS", "INTERNAL", "UNKNOWN"] as const)) invalid("channel kind");
  if (!isOneOf(row.discoveryStatus, ["PENDING", "UNRESOLVED"] as const)) invalid("channel discoveryStatus");
  return { channelId: nonblank(row.channelId, "channelId"), kind: row.kind as CandidateChannelKind,
    discoveryStatus: row.discoveryStatus as CandidateChannelStatus };
}

function parseRisk(value: unknown, index: number): CandidateUnresolvedRisk {
  const row = exactObject(value, ["code", "detail", "followUp"], `unresolvedRisk[${index}]`);
  return { code: nonblank(row.code, "risk.code"), detail: nonblank(row.detail, "risk.detail"),
    followUp: nonblank(row.followUp, "risk.followUp") };
}

function validateExactPartition(companies: readonly OfficialSourceResearchCandidateCompany[], batchId: ResearchBatchId): void {
  const actual = companies.map((company) => company.confirmedV3Id);
  if (actual.length !== 15 || JSON.stringify(actual) !== JSON.stringify(EXPECTED_PARTITIONS[batchId])) {
    invalid("exact batch partition");
  }
}

export function mergeOfficialSourceResearchCandidateBatches(
  batches: readonly OfficialSourceResearchCandidateBatch[]
): MergedOfficialSourceResearchCandidates {
  const byId = new Map(batches.map((batch) => [batch.batchId, batch]));
  if (batches.length !== 4 || byId.size !== 4 || !(["F01", "F02", "D01", "D02"] as const).every((id) => byId.has(id))) {
    invalid("exact four batches");
  }
  for (const batch of batches) validateExactPartition(batch.companies, batch.batchId);
  const companies = (["F01", "F02", "D01", "D02"] as const).flatMap((id) => byId.get(id)!.companies);
  unique(companies.map((company) => company.confirmedV3Id), "merged confirmedV3Id");
  unique(companies.map((company) => company.runtimeId), "merged runtimeId");
  const base = {
    schemaVersion: OFFICIAL_SOURCE_RESEARCH_CANDIDATE_SCHEMA_VERSION,
    batchIds: ["F01", "F02", "D01", "D02"] as ResearchBatchId[], discoveryOnly: true as const,
    oracleStatus: "RESEARCH_PENDING_INDEPENDENT_VERIFICATION" as const, promotionCount: 0 as const, companies
  };
  return { ...base, sha256: canonicalCandidateHash(base) };
}

export function canonicalCandidateHash(value: OfficialSourceResearchCandidateBatch | Omit<MergedOfficialSourceResearchCandidates, "sha256">): string {
  return createHash("sha256").update(canonicalJson(canonicalCandidateShape(value)), "utf8").digest("hex");
}

function canonicalCandidateShape(value: OfficialSourceResearchCandidateBatch | Omit<MergedOfficialSourceResearchCandidates, "sha256">): unknown {
  const clone = structuredClone(value) as any;
  for (const company of clone.companies) {
    company.officialWebsiteUrls.sort(compareUtf8);
    sortCanonical(company.officialDomainProvenance);
    sortCanonical(company.unresolvedRisks);
    for (const surface of company.surfaces) {
      sortCanonical(surface.channels);
      sortCanonical(surface.officialChainEvidence);
      sortCanonical(surface.officialChainHops);
      for (const field of ["legalEntityScope", "businessUnitScope", "brandScope"]) {
        sortCanonical(surface[field]);
      }
    }
    sortCanonical(company.surfaces);
  }
  sortCanonical(clone.companies);
  if (clone.batchIds) clone.batchIds.sort(compareUtf8);
  return clone;
}

function sortCanonical(values: any[]): void {
  values.sort((left, right) => compareUtf8(canonicalJson(left), canonicalJson(right)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compareUtf8(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateOfficialSourceResearchCandidateJson(
  text: string,
  now = new Date()
): { ok: true; batch: OfficialSourceResearchCandidateBatch; sha256: string } | { ok: false; diagnostics: readonly { code: string; message: string }[] } {
  try {
    const batch = parseOfficialSourceResearchCandidateBatch(JSON.parse(text), now);
    return { ok: true, batch, sha256: canonicalCandidateHash(batch) };
  } catch {
    return { ok: false, diagnostics: [{ code: "CANDIDATE_INVALID", message: "Candidate file failed the canonical discovery-only contract." }] };
  }
}

function exactObject(value: unknown, keys: readonly string[], field: string): Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(field);
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== "string") || actual.length !== keys.length ||
      actual.some((key) => typeof key === "string" && !keys.includes(key))) invalid(`${field} keys`);
  for (const key of actual as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid(`${field} descriptor`);
  }
  return value;
}

function strictIso(value: unknown, field: string, now: Date): Date {
  const text = nonblank(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)) invalid(field);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== text || parsed.getTime() > now.getTime()) invalid(field);
  return parsed;
}

function safeHttps(value: unknown, field: string): string {
  const text = nonblank(value, field);
  let url: URL;
  try { url = new URL(text); } catch { invalid(field); }
  if (url!.protocol !== "https:" || url!.username || url!.password || !url!.hostname) invalid(field);
  const decoded = decodeURIComponent(text).normalize("NFKC");
  if (/(?:api[_-]?key|token|secret|password|authorization)\s*=/iu.test(decoded)) invalid(field);
  return url!.toString();
}

function isSameOrSubdomain(host: string, parent: string): boolean {
  return host === parent || host.endsWith(`.${parent}`);
}

function isDeniedOfficialHost(host: string): boolean {
  return DENIED_OFFICIAL_HOSTS.some((denied) => isSameOrSubdomain(host, denied));
}

function nullableHttps(value: unknown, field: string): string | null {
  return value === null ? null : safeHttps(value, field);
}

function nonblank(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) invalid(field);
  return value.trim();
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(field);
  return value;
}

function unique(values: readonly string[], field: string): string[] {
  if (new Set(values).size !== values.length) invalid(field);
  return [...values];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function invalid(field: string): never {
  throw new Error(`CANDIDATE_CONTRACT_INVALID:${field}`);
}
