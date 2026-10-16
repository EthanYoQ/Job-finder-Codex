import { load } from "cheerio";
import { createHttpHtmlSourceFetch, type HttpHtmlClient } from "./httpHtmlSourceFetch";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpClient } from "./officialJsonSourceFetch";
import { OFFICIAL_API_JSON_CONFIG } from "./companyRecruitmentProfiles/shared";
import { expectedChannelSetHash, sourcePlanConfigSha256, type SourceCrawlPlan } from "./sourcePlan";
import { runSourceCrawl, type SourceCrawlResult } from "./runSourceCrawl";
import { currentOfficialSourceAttemptSignal, runWithOfficialSourceAttemptTimeout } from "./officialHttpRuntimeLimits";
import type { NormalizedJobRecord } from "./normalizedJob";
import { validateQiluForeignLossRowsForDiagnostic } from "./strictSourceScopeExclusionProof";

const MARKETING_ENTRY = "https://www.qilu-pharma.com/JobPosting_list.html";
const NONMARKETING_ENTRY = "https://qilu-pharma.zhiye.com/social/jobs";
const NONMARKETING_LANDING = "https://qilu-pharma.zhiye.com/social";
const sourceId = "source-qilu-social";
type PartitionId = "qilu-marketing" | "qilu-non-marketing";

export interface QiluMainPartitionCapture {
  classification: "QILU_MAIN_PARTITION_CANDIDATE_NOT_QUALIFICATION";
  sourceId: "source-qilu-social";
  state: "COLLECTED" | "INCOMPLETE";
  qualificationEligible: false;
  crossPartitionEquivalence: "NOT_ESTABLISHED";
  partitions: Array<{
    partitionId: PartitionId;
    sourcePlanSha256: string;
    state: "COLLECTED" | "FAILED" | "ABORTED" | "RUNNING" | "NOT_ATTEMPTED";
    result?: SourceCrawlResult;
  }>;
  candidateRecords: NormalizedJobRecord[];
  rawObservationCount: number;
  scopeDiscardCount: number;
  failureCodes: string[];
  gaps: readonly string[];
}

export function qiluPartitionPlans(): readonly [SourceCrawlPlan, SourceCrawlPlan] {
  const channel = { channelId: `source:${sourceId}:default`, kind: "SOCIAL" as const };
  const common = {
    company: { id: "company-qilu", officialChineseName: "齐鲁制药集团有限公司", category: "DOMESTIC_PHARMA" as const },
    expectedChannels: [channel], expectedChannelSetHash: expectedChannelSetHash([channel]),
    transportPolicy: { primary: "DIRECT_HTTP" as const }
  };
  const source = { id: sourceId, companyId: "company-qilu", kind: "SOCIAL" as const, status: "VERIFIED_SCRAPABLE" as const,
    surfaceId: "surface-qilu-social", officialChainEvidenceUrl: MARKETING_ENTRY };
  return [
    { ...common, adapterId: "html-table", source: { ...source, atsKind: "OFFICIAL_HTML", officialEntryUrl: MARKETING_ENTRY },
      table: { rowSelector: ".e_loop-65 .cbox-65.p_loopitem", completenessProof: { kind: "STATIC_PUBLIC_LIST" },
        staticPublicList: { containerSelector: ".e_loop-65", nextControlSelector: ".p_page .page_next:not(.disabled)" },
        fields: { officialTitle: { selector: ".e_text-83 a" }, officialUrl: { selector: ".e_text-83 a", attribute: "href" },
          locationRaw: { selector: ".e_text-86" } } } },
    { ...common, adapterId: "official-json", source: { ...source, atsKind: "BEISEN_ZHIYE", officialEntryUrl: NONMARKETING_ENTRY },
      json: OFFICIAL_API_JSON_CONFIG, officialJsonFetch: { kind: "beisen-zhiye-2022", category: "1", pageSize: 15,
        maxPages: 100, detailPath: "social/detail", displayFields: ["Category", "LocId", "Org", "PostDate", "WorkWeChatQrCode"],
        geographyScope: "DOMESTIC_OFFICIAL_TENANT", scopeExclusionProof: "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2" } }
  ];
}

function structurallyCollected(result: SourceCrawlResult, partitionId: PartitionId): boolean {
  const evidence = result.fetchEvidence;
  const reconciliation = result.reconciliation;
  return result.truth.transportSuccess && result.truth.adapterSuccess && result.paginationEvaluation?.safeCompleteness === true &&
    result.paginationEvaluation.verifiedEligible === true && evidence !== undefined && evidence.fetchCounts.parseDiscardCount === 0 &&
    evidence.fetchCounts.rawCount === evidence.fetchCounts.validCount + evidence.fetchCounts.validationDiscardCount &&
    evidence.fetchLosses.length === evidence.fetchCounts.validationDiscardCount &&
    evidence.fetchLosses.every((loss) => loss.stage === "VALIDATION" && loss.details?.code === "OUT_OF_SCOPE") &&
    (partitionId !== "qilu-non-marketing" || validateQiluForeignLossRowsForDiagnostic(evidence)) &&
    reconciliation !== undefined && reconciliation.adapterLosses.length === 0 && reconciliation.collisionGroups.length === 0;
}

function hasNonMarketingOfficialLink(result: SourceCrawlResult | undefined): boolean {
  const entry = result?.fetchEvidence?.artifacts.find((artifact) => artifact.requestedUrl === MARKETING_ENTRY &&
    artifact.finalUrl === MARKETING_ENTRY && artifact.httpStatus === 200 && artifact.bodyRepresentation === "EXACT");
  if (!entry) return false;
  const $ = load(typeof entry.body === "string" ? entry.body : Buffer.from(entry.body));
  return $("a[href]").toArray().some((element) => {
    const anchor = $(element);
    try {
      return new URL(anchor.attr("href")!, MARKETING_ENTRY).href === NONMARKETING_LANDING &&
        /社会招聘/u.test(anchor.text()) && /非营销/u.test(anchor.text());
    } catch { return false; }
  });
}

/**
 * Runs the existing HTTP/HTML and Beisen drivers as two mandatory collections.
 * It is deliberately not registered as a production SourceFetchFunction: the
 * composite traversal/oracle policy still needs admission. Results retain raw
 * evidence privately; callers must not publish nested partial partition jobs.
 */
export async function collectQiluMainPartitions(deps: {
  marketingHttp?: HttpHtmlClient;
  nonMarketingHttp?: OfficialJsonHttpClient;
  now?: () => Date;
} = {}): Promise<QiluMainPartitionCapture> {
  const plans = qiluPartitionPlans();
  const ids: readonly PartitionId[] = ["qilu-marketing", "qilu-non-marketing"];
  const partitions: QiluMainPartitionCapture["partitions"] = plans.map((plan, index) => ({
    partitionId: ids[index]!, sourcePlanSha256: sourcePlanConfigSha256(plan), state: "NOT_ATTEMPTED"
  }));
  const failureCodes: string[] = [];
  const fetchers = [
    createHttpHtmlSourceFetch({ ...(deps.marketingHttp ? { http: deps.marketingHttp } : {}), ...(deps.now ? { now: deps.now } : {}) }),
    createOfficialJsonSourceFetch({ ...(deps.nonMarketingHttp ? { http: deps.nonMarketingHttp } : {}), ...(deps.now ? { now: deps.now } : {}) })
  ];
  const collect = async () => {
      const signal = currentOfficialSourceAttemptSignal();
      for (let index = 0; index < plans.length; index += 1) {
        if (signal?.aborted) throw signal.reason;
        const partition = partitions[index]!;
        partition.state = "RUNNING";
        try {
          const result = await runSourceCrawl(plans[index]!, { fetch: fetchers[index]!, isBaseline: true });
          if (signal?.aborted) throw signal.reason;
          partition.result = result;
          partition.state = structurallyCollected(result, partition.partitionId) ? "COLLECTED" : "FAILED";
          if (partition.state === "FAILED") failureCodes.push(`QILU_PARTITION_INCOMPLETE:${partition.partitionId}`);
        } catch {
          if (signal?.aborted) { partition.state = "ABORTED"; throw signal.reason; }
          partition.state = "FAILED";
          failureCodes.push(`QILU_PARTITION_DRIVER_FAILED:${partition.partitionId}`);
        }
      }
  };
  try {
    if (currentOfficialSourceAttemptSignal()) await collect();
    else await runWithOfficialSourceAttemptTimeout(collect);
  } catch {
    for (const partition of partitions) if (partition.state === "RUNNING") partition.state = "ABORTED";
    failureCodes.push("QILU_COMPOSITE_ATTEMPT_ABORTED");
  }
  if (!hasNonMarketingOfficialLink(partitions[0]?.result)) failureCodes.push("QILU_NONMARKETING_OFFICIAL_CHAIN_MISSING");
  if (partitions[0]?.result?.jobs.some((job) => {
    try {
      const url = new URL(job.officialUrl);
      return url.origin !== "https://www.qilu-pharma.com" || !url.pathname.startsWith("/JobPosting_Detail/") ||
        url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
    } catch { return true; }
  })) {
    partitions[0].state = "FAILED";
    failureCodes.push("QILU_MARKETING_JOB_IDENTITY_INVALID");
  }
  const records = partitions.flatMap((partition) => partition.result?.jobs ?? []);
  if (new Set(records.map((job) => job.officialUrl)).size !== records.length) failureCodes.push("QILU_CROSS_PARTITION_URL_COLLISION");
  const collected = failureCodes.length === 0 && partitions.every((partition) => partition.state === "COLLECTED");
  return {
    classification: "QILU_MAIN_PARTITION_CANDIDATE_NOT_QUALIFICATION", sourceId,
    state: collected ? "COLLECTED" : "INCOMPLETE", qualificationEligible: false, crossPartitionEquivalence: "NOT_ESTABLISHED",
    partitions: partitions.map((partition) => ({ ...partition })), candidateRecords: collected ? records : [],
    rawObservationCount: partitions.reduce((sum, partition) => sum + (partition.result?.fetchEvidence?.fetchCounts.rawCount ?? 0), 0),
    scopeDiscardCount: partitions.reduce((sum, partition) => sum + (partition.result?.fetchEvidence?.fetchLosses.filter((loss) => loss.details?.code === "OUT_OF_SCOPE").length ?? 0), 0),
    failureCodes,
    gaps: ["COMPOSITE_SOURCE_POLICY_NOT_ADMITTED", "INDEPENDENT_PARTITION_PROOFS_NOT_BOUND", "SOURCE_ORACLE_AND_RUNTIME_NOT_BOUND",
      "CROSS_PARTITION_ALIAS_EQUIVALENCE_NOT_ESTABLISHED", "DRIVER_EXCLUSIONS_NOT_SIGNED_SCOPE_PROOF", "ADDITIONAL_OFFICIAL_ENTRY_REVIEW_REQUIRED"]
  };
}
