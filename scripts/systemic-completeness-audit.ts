import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { candidateCompanies, type CandidateCompany } from "../src/data/companyRegistry";
import { buildSourceCrawlPlans, type SourceCrawlPlan } from "../src/crawler/sourcePlan";

const TRUST_FREEZE_STATUS = "UNTRUSTED_PENDING_COMPLETENESS_AUDIT";
const OUTPUT_JSON = "docs/research/systemic-completeness-audit-2026-07-09.json";
const OUTPUT_MARKDOWN = "docs/research/systemic-completeness-audit-2026-07-09.md";
const LOW_COUNT_ANOMALIES = new Set([0, 1, 2, 3, 5, 8]);

type OfficialEntryAuditStatus =
  | "OFFICIAL_ENTRY_CONFIRMED"
  | "OFFICIAL_ENTRY_CONFIRMED_BUT_NOT_STRUCTURED"
  | "WAF_OR_GEOBLOCK_BLOCKED"
  | "ONLY_OFFICIAL_WECHAT_OR_EMAIL"
  | "ATS_FOUND_BUT_NO_OFFICIAL_BACKLINK"
  | "NO_PUBLIC_ENTRY_AFTER_STANDARD_SEARCH"
  | "OUT_OF_SCOPE_OR_REPLACE_CANDIDATE";

type ExpectedEvidenceKind =
  | "OFFICIAL_TOTAL_COUNT"
  | "TOTAL_PAGES_PAGE_SIZE"
  | "COMPLETE_NEXT_PAGE_TRAVERSAL"
  | "COMPLETE_CHANNEL_TRAVERSAL"
  | "MANUAL_BROWSER_AUDIT_WEAK"
  | "NONE";

type AuditCompletenessStatus =
  | "VERIFIED_STRONG"
  | "VERIFIED_WEAK_MANUAL_REVIEW"
  | "INCOMPLETE"
  | "BLOCKED"
  | "FAILED";

interface LatestObservationRow {
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  structuredJobCount: number;
  expectedJobCount: number | null;
  completenessStatus: string | null;
  completenessEvidenceKind: string | null;
  completenessEvidenceUrl: string | null;
  completenessBlockerReason: string | null;
  totalPages: number | null;
  pageSize: number | null;
  pagesVisited: number | null;
  failureReason: string | null;
}

interface OfficialEntryAuditRow {
  companyId: string;
  companyName: string;
  sourceId: string;
  atsKind: string;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  sourceBackedByOfficialSite: boolean;
  standardSearchStatus: OfficialEntryAuditStatus;
  attemptedUrlNotes: string;
  blockerReason: string;
  auditTimestamp: string;
}

interface SourceCompletenessAuditRow {
  companyId: string;
  companyName: string;
  sourceId: string;
  atsKind: string;
  adapterKind: string;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  sourceBackedByOfficialSite: boolean;
  observedStructuredCount: number | null;
  activeVisibleCount: number;
  expectedJobCount: number | null;
  expectedEvidenceKind: ExpectedEvidenceKind;
  totalPages: number | null;
  pageSize: number | null;
  pagesVisited: number | null;
  channelsVisited: number | null;
  dedupeInputCount: number | null;
  dedupeOutputCount: number | null;
  dedupeEvidence: string;
  filtersApplied: Record<string, unknown>;
  completenessStatus: AuditCompletenessStatus;
  blockerReason: string;
  auditTimestamp: string;
}

interface SystemicCompletenessAuditReport {
  generatedAt: string;
  trustFreezeStatus: typeof TRUST_FREEZE_STATUS;
  trustFreezeReason: string;
  persistedObservationAvailable: boolean;
  persistedObservationError: string;
  officialEntryAudit: OfficialEntryAuditRow[];
  sourceCompletenessAudit: SourceCompletenessAuditRow[];
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const report = await buildSystemicCompletenessAuditReport({
      companies: candidateCompanies,
      plans: buildSourceCrawlPlans(candidateCompanies),
      db: prisma,
      auditTimestamp: new Date().toISOString()
    });
    writeReportFiles(report);
    console.log(`# Systemic Completeness Audit`);
    console.log(`Trust freeze: ${report.trustFreezeStatus}`);
    console.log(`Official entry rows: ${report.officialEntryAudit.length}`);
    console.log(`Source completeness rows: ${report.sourceCompletenessAudit.length}`);
    console.log(`JSON: ${OUTPUT_JSON}`);
    console.log(`Markdown: ${OUTPUT_MARKDOWN}`);
  } finally {
    await prisma.$disconnect();
  }
}

export async function buildSystemicCompletenessAuditReport({
  companies,
  plans,
  db,
  auditTimestamp
}: {
  companies: readonly CandidateCompany[];
  plans: readonly SourceCrawlPlan[];
  db: PrismaClient;
  auditTimestamp: string;
}): Promise<SystemicCompletenessAuditReport> {
  const persisted = await persistedAuditInputs(db);

  return {
    generatedAt: auditTimestamp,
    trustFreezeStatus: TRUST_FREEZE_STATUS,
    trustFreezeReason:
      "Current counts have official-link and observation evidence but are not trusted until source completeness, filters, pagination/channel traversal, dedupe behavior, and active-visible consistency are audited.",
    persistedObservationAvailable: persisted.available,
    persistedObservationError: persisted.error,
    officialEntryAudit: buildOfficialEntryAuditRows({
      companies,
      plans,
      auditTimestamp
    }),
    sourceCompletenessAudit: buildSourceCompletenessAuditRows({
      plans,
      latestObservationBySource: persisted.latestObservationBySource,
      activeVisibleCountsBySource: persisted.activeVisibleCountsBySource,
      persistedObservationError: persisted.error,
      auditTimestamp
    })
  };
}

function buildOfficialEntryAuditRows({
  companies,
  plans,
  auditTimestamp
}: {
  companies: readonly CandidateCompany[];
  plans: readonly SourceCrawlPlan[];
  auditTimestamp: string;
}): OfficialEntryAuditRow[] {
  const plannedSourceIds = new Set(plans.map((plan) => plan.source.id));
  return companies.map((company) => {
    const source = company.sources.find((item) => item.kind === "SOCIAL");
    const sourceId = source?.id ?? "";
    const officialEntryUrl = source?.officialEntryUrl ?? "";
    const officialChainEvidenceUrl = source?.officialChainEvidenceUrl ?? "";
    const sourceBackedByOfficialSite = officialChainEvidenceUrl.length > 0;
    const standardSearchStatus = officialEntryStatus({
      sourcePlanned: plannedSourceIds.has(sourceId),
      officialEntryUrl,
      officialChainEvidenceUrl,
      sourceStatus: source?.status ?? "UNVERIFIED",
      atsKind: source?.atsKind ?? "UNKNOWN"
    });

    return {
      companyId: company.id,
      companyName: company.officialChineseName,
      sourceId,
      atsKind: source?.atsKind ?? "UNKNOWN",
      officialEntryUrl,
      officialChainEvidenceUrl,
      sourceBackedByOfficialSite,
      standardSearchStatus,
      attemptedUrlNotes: attemptedUrlNotes(company, officialEntryUrl, officialChainEvidenceUrl),
      blockerReason: entryBlockerReason(standardSearchStatus),
      auditTimestamp
    };
  });
}

function buildSourceCompletenessAuditRows({
  plans,
  latestObservationBySource,
  activeVisibleCountsBySource,
  persistedObservationError,
  auditTimestamp
}: {
  plans: readonly SourceCrawlPlan[];
  latestObservationBySource: ReadonlyMap<string, LatestObservationRow>;
  activeVisibleCountsBySource: ReadonlyMap<string, number>;
  persistedObservationError: string;
  auditTimestamp: string;
}): SourceCompletenessAuditRow[] {
  return plans.map((plan) => {
    const observation = latestObservationBySource.get(plan.source.id);
    const activeVisibleCount = activeVisibleCountsBySource.get(plan.source.id) ?? 0;
    const filtersApplied = filtersForPlan(plan);
    const expectedEvidenceKind = evidenceKindForPlan(plan, observation);
    const channelsVisited = channelsVisitedForPlan(plan, observation);
    const blockerReason = completenessBlockerReason({
      plan,
      observation,
      activeVisibleCount,
      expectedEvidenceKind,
      persistedObservationError
    });

    return {
      companyId: plan.company.id,
      companyName: plan.company.officialChineseName,
      sourceId: plan.source.id,
      atsKind: plan.source.atsKind,
      adapterKind: plan.adapterId,
      officialEntryUrl: plan.source.officialEntryUrl,
      officialChainEvidenceUrl: plan.source.officialChainEvidenceUrl,
      sourceBackedByOfficialSite: Boolean(plan.source.officialChainEvidenceUrl),
      observedStructuredCount: observation?.structuredJobCount ?? null,
      activeVisibleCount,
      expectedJobCount: observation?.expectedJobCount ?? null,
      expectedEvidenceKind,
      totalPages: observation?.totalPages ?? null,
      pageSize: observation?.pageSize ?? null,
      pagesVisited: observation?.pagesVisited ?? null,
      channelsVisited,
      dedupeInputCount: null,
      dedupeOutputCount: observation?.structuredJobCount ?? null,
      dedupeEvidence: "NOT_CAPTURED_CURRENTLY",
      filtersApplied,
      completenessStatus: classifyCompleteness({
        plan,
        observation,
        activeVisibleCount,
        expectedEvidenceKind,
        blockerReason
      }),
      blockerReason,
      auditTimestamp
    };
  });
}

async function latestObservationsBySource(db: PrismaClient): Promise<Map<string, LatestObservationRow>> {
  const observations = await db.crawlObservation.findMany({
    orderBy: [{ sourceId: "asc" }, { crawledAt: "desc" }]
  });
  const latest = new Map<string, LatestObservationRow>();
  for (const observation of observations) {
    if (latest.has(observation.sourceId)) {
      continue;
    }
    latest.set(observation.sourceId, {
      sourceId: observation.sourceId,
      crawledAt: observation.crawledAt,
      successful: observation.successful,
      structuredJobCount: observation.structuredJobCount,
      expectedJobCount: observation.expectedJobCount,
      completenessStatus: observation.completenessStatus,
      completenessEvidenceKind: observation.completenessEvidenceKind,
      completenessEvidenceUrl: observation.completenessEvidenceUrl,
      completenessBlockerReason: observation.completenessBlockerReason,
      totalPages: observation.totalPages,
      pageSize: observation.pageSize,
      pagesVisited: observation.pagesVisited,
      failureReason: observation.failureReason
    });
  }
  return latest;
}

async function persistedAuditInputs(db: PrismaClient): Promise<{
  available: boolean;
  error: string;
  latestObservationBySource: Map<string, LatestObservationRow>;
  activeVisibleCountsBySource: Map<string, number>;
}> {
  try {
    const [latestObservationBySource, activeVisibleCountsBySource] = await Promise.all([
      latestObservationsBySource(db),
      activeVisibleJobCountsBySource(db)
    ]);
    return {
      available: true,
      error: "",
      latestObservationBySource,
      activeVisibleCountsBySource
    };
  } catch (error) {
    return {
      available: false,
      error: summarizePersistedAuditError(error),
      latestObservationBySource: new Map(),
      activeVisibleCountsBySource: new Map()
    };
  }
}

function summarizePersistedAuditError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const databaseReachability = message.match(/Can't reach database server at `([^`]+)`/u);
  if (databaseReachability) {
    return `Can't reach database server at ${databaseReachability[1]}. Persisted crawl observations and active visible job counts are unavailable.`;
  }
  return message.replace(/\s+/gu, " ").trim();
}

async function activeVisibleJobCountsBySource(db: PrismaClient): Promise<Map<string, number>> {
  const rows = await db.job.groupBy({
    by: ["sourceId"],
    where: {
      lifecycleStatus: "ACTIVE",
      visibleInFrontend: true
    },
    _count: {
      _all: true
    }
  });
  return new Map(rows.map((row) => [row.sourceId, row._count._all]));
}

function officialEntryStatus({
  sourcePlanned,
  officialEntryUrl,
  officialChainEvidenceUrl,
  sourceStatus,
  atsKind
}: {
  sourcePlanned: boolean;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  sourceStatus: string;
  atsKind: string;
}): OfficialEntryAuditStatus {
  if (sourceStatus === "EXCLUDED") {
    return "OUT_OF_SCOPE_OR_REPLACE_CANDIDATE";
  }
  if (sourcePlanned) {
    return "OFFICIAL_ENTRY_CONFIRMED";
  }
  if (!officialEntryUrl && !officialChainEvidenceUrl) {
    return "NO_PUBLIC_ENTRY_AFTER_STANDARD_SEARCH";
  }
  if (officialEntryUrl && !officialChainEvidenceUrl && isAtsUrl(officialEntryUrl)) {
    return "ATS_FOUND_BUT_NO_OFFICIAL_BACKLINK";
  }
  if (officialEntryUrl || officialChainEvidenceUrl) {
    return atsKind === "UNKNOWN"
      ? "OFFICIAL_ENTRY_CONFIRMED_BUT_NOT_STRUCTURED"
      : "OFFICIAL_ENTRY_CONFIRMED_BUT_NOT_STRUCTURED";
  }
  return "NO_PUBLIC_ENTRY_AFTER_STANDARD_SEARCH";
}

function attemptedUrlNotes(
  company: CandidateCompany,
  officialEntryUrl: string,
  officialChainEvidenceUrl: string
): string {
  return [
    company.officialWebsiteUrl ? `officialWebsite=${company.officialWebsiteUrl}` : "officialWebsite=missing",
    officialEntryUrl ? `entry=${officialEntryUrl}` : "entry=missing",
    officialChainEvidenceUrl ? `chain=${officialChainEvidenceUrl}` : "chain=missing"
  ].join("; ");
}

function entryBlockerReason(status: OfficialEntryAuditStatus): string {
  switch (status) {
    case "OFFICIAL_ENTRY_CONFIRMED":
      return "";
    case "OFFICIAL_ENTRY_CONFIRMED_BUT_NOT_STRUCTURED":
      return "Official entry exists or is suspected, but no structured verified source plan is accepted yet.";
    case "WAF_OR_GEOBLOCK_BLOCKED":
      return "Official path is blocked by WAF or geoblocking in the current environment.";
    case "ONLY_OFFICIAL_WECHAT_OR_EMAIL":
      return "Only official WeChat, QR, or email evidence is available; no structured official list.";
    case "ATS_FOUND_BUT_NO_OFFICIAL_BACKLINK":
      return "ATS tenant was found, but official website backlink has not been proven.";
    case "NO_PUBLIC_ENTRY_AFTER_STANDARD_SEARCH":
      return "No public official entry is recorded after the current standard-search pass.";
    case "OUT_OF_SCOPE_OR_REPLACE_CANDIDATE":
      return "Company/source is out of strict pharma scope or should be replaced by ranked backfill.";
  }
}

function evidenceKindForPlan(
  plan: SourceCrawlPlan,
  observation: LatestObservationRow | undefined
): ExpectedEvidenceKind {
  if (!observation?.completenessEvidenceKind) {
    return "NONE";
  }
  if (observation.completenessEvidenceKind === "OFFICIAL_TOTAL_COUNT") {
    return "OFFICIAL_TOTAL_COUNT";
  }
  if (observation.completenessEvidenceKind === "OFFICIAL_TOTAL_PAGES") {
    return "TOTAL_PAGES_PAGE_SIZE";
  }
  if (observation.completenessEvidenceKind === "COMPLETE_PAGE_TRAVERSAL") {
    return isRedseaPlan(plan) ? "COMPLETE_CHANNEL_TRAVERSAL" : "COMPLETE_NEXT_PAGE_TRAVERSAL";
  }
  if (observation.completenessEvidenceKind === "WEAK_MANUAL_SAMPLE") {
    return "MANUAL_BROWSER_AUDIT_WEAK";
  }
  return "NONE";
}

function channelsVisitedForPlan(
  plan: SourceCrawlPlan,
  observation: LatestObservationRow | undefined
): number | null {
  if (!isRedseaPlan(plan)) {
    return null;
  }
  return observation?.pagesVisited ?? plan.officialJsonFetch.channelQrIds.length;
}

function filtersForPlan(plan: SourceCrawlPlan): Record<string, unknown> {
  if ("workday" in plan && plan.workday) {
    return {
      adapter: "workday",
      tenant: plan.workday.tenant,
      site: plan.workday.site,
      searchText: plan.workday.searchText ?? null,
      appliedFacets: plan.workday.appliedFacets ?? null,
      pageSize: plan.workday.pageSize ?? null,
      maxPages: plan.workday.maxPages ?? null
    };
  }
  if ("officialJsonFetch" in plan && plan.officialJsonFetch) {
    return {
      adapter: plan.officialJsonFetch.kind,
      ...plan.officialJsonFetch
    };
  }
  if ("hotjob" in plan && plan.hotjob) {
    return { adapter: "hotjob-wecruit", ...plan.hotjob };
  }
  if ("hotjobLegacy" in plan && plan.hotjobLegacy) {
    return { adapter: "hotjob-legacy", ...plan.hotjobLegacy };
  }
  if (plan.adapterId === "html-table") {
    return {
      adapter: "html-table",
      rowSelector: plan.table.rowSelector,
      pagination: plan.table.pagination ?? null
    };
  }
  return {};
}

function completenessBlockerReason({
  plan,
  observation,
  activeVisibleCount,
  expectedEvidenceKind,
  persistedObservationError
}: {
  plan: SourceCrawlPlan;
  observation: LatestObservationRow | undefined;
  activeVisibleCount: number;
  expectedEvidenceKind: ExpectedEvidenceKind;
  persistedObservationError: string;
}): string {
  if (!observation) {
    if (persistedObservationError) {
      return `Persisted observation unavailable: ${persistedObservationError}`;
    }
    return "No persisted crawl observation exists for this planned source.";
  }
  if (!observation.successful) {
    return observation.failureReason ?? "Latest crawl failed.";
  }
  if (observation.completenessStatus !== "VERIFIED") {
    return observation.completenessBlockerReason ?? `Completeness status is ${observation.completenessStatus ?? "missing"}.`;
  }
  if (observation.expectedJobCount !== null && observation.expectedJobCount !== observation.structuredJobCount) {
    return `Observed ${observation.structuredJobCount}, expected ${observation.expectedJobCount}.`;
  }
  if (observation.structuredJobCount !== activeVisibleCount) {
    return `Observed ${observation.structuredJobCount}, active visible ${activeVisibleCount}.`;
  }
  if (expectedEvidenceKind === "NONE") {
    return "No expected-count or traversal evidence is recorded.";
  }
  if (
    isTopThirtyCompany(plan.company.id) &&
    LOW_COUNT_ANOMALIES.has(observation.structuredJobCount) &&
    observation.completenessEvidenceKind !== "OFFICIAL_TOTAL_COUNT"
  ) {
    return `Low-count anomaly ${observation.structuredJobCount} for Top 30 source without official total-count evidence.`;
  }
  return observation.completenessBlockerReason ?? "";
}

function classifyCompleteness({
  observation,
  expectedEvidenceKind,
  blockerReason
}: {
  plan: SourceCrawlPlan;
  observation: LatestObservationRow | undefined;
  activeVisibleCount: number;
  expectedEvidenceKind: ExpectedEvidenceKind;
  blockerReason: string;
}): AuditCompletenessStatus {
  if (!observation) {
    return "BLOCKED";
  }
  if (!observation.successful) {
    return "FAILED";
  }
  if (blockerReason) {
    return "INCOMPLETE";
  }
  if (expectedEvidenceKind === "MANUAL_BROWSER_AUDIT_WEAK") {
    return "VERIFIED_WEAK_MANUAL_REVIEW";
  }
  return "VERIFIED_STRONG";
}

function isRedseaPlan(plan: SourceCrawlPlan): plan is SourceCrawlPlan & {
  officialJsonFetch: { kind: "redsea-zp-channel"; channelQrIds: string[] };
} {
  return (
    plan.adapterId === "official-json" &&
    "officialJsonFetch" in plan &&
    plan.officialJsonFetch?.kind === "redsea-zp-channel"
  );
}

function isTopThirtyCompany(companyId: string): boolean {
  return candidateCompanies.some(
    (company) =>
      company.id === companyId &&
      (company.category === "FOREIGN_PHARMA" ||
        company.category === "DOMESTIC_PHARMA")
  );
}

function isAtsUrl(url: string): boolean {
  return /(?:zhiye|hotjob|wintalent|workdayjobs|mokahr|phenom|successfactors|redsea)/iu.test(url);
}

function writeReportFiles(report: SystemicCompletenessAuditReport): void {
  mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
  writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(OUTPUT_MARKDOWN, renderMarkdown(report), "utf8");
}

function renderMarkdown(report: SystemicCompletenessAuditReport): string {
  return [
    "# Systemic Completeness Audit 2026-07-09",
    "",
    "## Trust Freeze",
    "",
    `Status: \`${report.trustFreezeStatus}\``,
    "",
    report.trustFreezeReason,
    "",
    `Persisted observations available: \`${report.persistedObservationAvailable ? "yes" : "no"}\``,
    report.persistedObservationError ? `Persisted observation error: \`${report.persistedObservationError}\`` : "",
    "",
    "Current source counts must not be delivered for manual review until the audit-fix-QA loop is complete.",
    "",
    "## Official Entry Audit",
    "",
    "| companyId | company | sourceId | atsKind | status | officialEntryUrl | chainEvidence | blocker |",
    "|---|---|---|---|---|---|---|---|",
    ...report.officialEntryAudit.map((row) =>
      [
        row.companyId,
        row.companyName,
        row.sourceId,
        row.atsKind,
        row.standardSearchStatus,
        row.officialEntryUrl || "missing",
        row.officialChainEvidenceUrl || "missing",
        row.blockerReason || ""
      ]
        .map(markdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |")
    ),
    "",
    "## Source Completeness Audit",
    "",
    "| company | sourceId | adapter | observed | expected | activeVisible | evidence | pages | channels | status | blocker | filters |",
    "|---|---|---|---:|---:|---:|---|---|---|---|---|---|",
    ...report.sourceCompletenessAudit.map((row) =>
      [
        row.companyName,
        row.sourceId,
        `${row.atsKind}/${row.adapterKind}`,
        String(row.observedStructuredCount ?? "missing"),
        String(row.expectedJobCount ?? "missing"),
        String(row.activeVisibleCount),
        row.expectedEvidenceKind,
        `${row.pagesVisited ?? "?"}/${row.totalPages ?? "?"}`,
        String(row.channelsVisited ?? ""),
        row.completenessStatus,
        row.blockerReason,
        JSON.stringify(row.filtersApplied)
      ]
        .map(markdownCell)
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |")
    ),
    ""
  ].join("\n");
}

function markdownCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\s+/gu, " ").trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
