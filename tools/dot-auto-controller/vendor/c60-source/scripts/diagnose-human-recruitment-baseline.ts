import { HUMAN_VERIFIED_RECRUITMENT_BASELINE } from "../src/data/humanVerifiedRecruitmentBaseline";
import { candidateCompanies } from "../src/data/companyRegistry";
import { createHttpHtmlSourceFetch } from "../src/crawler/httpHtmlSourceFetch";
import { createHotjobLegacySourceFetch } from "../src/crawler/hotjobLegacySourceFetch";
import { createHotjobWecruitSourceFetch } from "../src/crawler/hotjobWecruitSourceFetch";
import { createMokaSourceFetch } from "../src/crawler/mokaSourceFetch";
import { createOfficialJsonSourceFetch } from "../src/crawler/officialJsonSourceFetch";
import { createProfileBoundSourceFetch } from "../src/crawler/profileBoundSourceFetch";
import { runSourceCrawl, type SourceFetchFunction } from "../src/crawler/runSourceCrawl";
import { createSourceFetchRouter } from "../src/crawler/sourceFetchRouter";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../src/crawler/sourcePlan";
import { createWorkdaySourceFetch } from "../src/crawler/workdaySourceFetch";
import { createUnsupportedSourceFetch } from "../src/crawler/unsupportedSourceFetch";
import { assessHumanBaselineDiscrepancy } from "./human-baseline-discrepancy-policy";

const DEFAULT_SOURCE_IDS = [
  "source-novo-nordisk-china-social",
  "source-csl-china-social",
  "source-bms-china-social",
  "source-merck-china-social",
  "source-roche-china-social",
  "source-ucb-china-social",
  "source-pfizer-china-social",
  "source-amgen-china-social",
  "source-biogen-china-social",
  "source-qilu-social",
  "source-sandoz-china-social"
];

const plans = buildStagedSourceCrawlPlans(candidateCompanies);
const selectedSourceIds = process.argv.slice(2);
const baselineCompanyIds = new Set(HUMAN_VERIFIED_RECRUITMENT_BASELINE.companies.map(([companyId]) => companyId));
const sourceIds = selectedSourceIds.includes("--all")
  ? plans.filter((plan) => baselineCompanyIds.has(plan.company.id) && plan.source.kind === "SOCIAL")
      .map((plan) => plan.source.id)
  : selectedSourceIds.length > 0 ? selectedSourceIds : DEFAULT_SOURCE_IDS;
const baselineByCompanyId = new Map(
  HUMAN_VERIFIED_RECRUITMENT_BASELINE.companies.map((entry) => [entry[0], entry])
);
const routedFetch = createSourceFetchRouter({
  moka: createMokaSourceFetch(),
  html: createHttpHtmlSourceFetch(),
  officialJson: createOfficialJsonSourceFetch(),
  workday: createWorkdaySourceFetch(),
  hotjob: createHotjobWecruitSourceFetch(),
  hotjobLegacy: createHotjobLegacySourceFetch(),
  profileBoundSource: createProfileBoundSourceFetch(),
  fallback: createUnsupportedSourceFetch()
});

let failed = false;
const assessmentCounts: Record<string, number> = {};
for (const sourceId of sourceIds) {
  const plan = getPlanBySourceId(plans, sourceId);
  if (!plan) {
    console.log(JSON.stringify({ sourceId, status: "NO_STAGED_PLAN" }));
    failed = true;
    continue;
  }
  const fetch = sourceFetch(plan);
  const result = await runSourceCrawl(plan, { fetch });
  const baseline = baselineByCompanyId.get(plan.company.id);
  const expectedCount = baseline?.[1] ?? null;
  const actualCount = result.status === "SUCCESS" ? result.jobs.length : null;
  const comparison = result.status !== "SUCCESS"
    ? "FAILED"
    : expectedCount === null ? "UNKNOWN_BASELINE"
      : actualCount === expectedCount ? "MATCH" : "DRIFT";
  const fetchLossCount = result.fetchEvidence
    ? result.fetchEvidence.fetchCounts.parseDiscardCount + result.fetchEvidence.fetchCounts.validationDiscardCount
    : 0;
  const delta = actualCount === null || expectedCount === null ? null : actualCount - expectedCount;
  const legalDedupeCount = result.reconciliation.collisionGroups.reduce(
    (sum, group) => sum + group.droppedCount,
    0
  );
  const officialRawCount = result.fetchEvidence?.fetchCounts.rawCount ?? result.reconciliation.rawInputCount;
  const scopeExcludedCount = result.fetchEvidence?.fetchLosses.filter((loss) =>
    isScopeExclusionCode(loss.details?.code)
  ).length ?? 0;
  const assessment = assessHumanBaselineDiscrepancy({
    baselineCount: expectedCount,
    actualCount,
    crawlStatus: result.status,
    completenessVerified: result.truth.completenessVerified,
    unaccountedLossCount: result.truth.completenessVerified
      ? 0
      : fetchLossCount + result.reconciliation.adapterLosses.length,
    baselineScopeConflict: baseline?.[3]?.startsWith("Conflict found") ?? false,
    rawInputCount: officialRawCount,
    legalDedupeCount,
    scopeExcludedCount,
    hasBaselineJobSet: false
  });
  assessmentCounts[assessment.historicalAssessment] =
    (assessmentCounts[assessment.historicalAssessment] ?? 0) + 1;
  console.log(JSON.stringify({
    sourceId,
    companyId: plan.company.id,
    expectedCount,
    actualCount,
    comparison,
    assessment: assessment.historicalAssessment,
    deltaSeverity: assessment.deltaSeverity,
    reviewRequired: assessment.reviewRequired,
    blocking: assessment.blocking,
    baselineJobSetAvailable: assessment.baselineJobSetAvailable,
    baselineObservationTiming: HUMAN_VERIFIED_RECRUITMENT_BASELINE.observationTiming,
    delta,
    completenessVerified: result.truth.completenessVerified,
    reconciliation: {
      rawInputCount: result.reconciliation.rawInputCount,
      validBeforeDedupeCount: result.reconciliation.validBeforeDedupeCount,
      dedupeOutputCount: result.reconciliation.dedupeOutputCount,
      legalDedupeCount,
      officialRawCount,
      scopeExcludedCount,
      lossCounts: Object.fromEntries([...new Set(result.reconciliation.adapterLosses.map((loss) => loss.reason))]
        .map((reason) => [reason, result.reconciliation.adapterLosses.filter((loss) => loss.reason === reason).length]))
    },
    fetchCounts: result.fetchEvidence?.fetchCounts,
    pages: result.fetchEvidence?.pages.map((page) => ({
      sequence: page.sequence,
      requestedPage: page.requestedPage,
      returnedPage: page.returnedPage,
      rawCount: page.rawJobIds.length,
      validCount: page.validJobIds.length,
      declaredTotal: page.declaredTotal,
      termination: page.termination
    })),
    pagination: result.paginationEvaluation && {
      safeCompleteness: result.paginationEvaluation.safeCompleteness,
      verifiedEligible: result.paginationEvaluation.verifiedEligible,
      anomalies: result.paginationEvaluation.derivedAnomalyCodes
    },
    ...(result.status === "FAILED" ? { failureReason: result.observation.failureReason } : {})
  }));
  if (comparison === "FAILED" || assessment.blocking) failed = true;
}

console.log(JSON.stringify({
  summary: {
    baselineObservationTiming: HUMAN_VERIFIED_RECRUITMENT_BASELINE.observationTiming,
    sourceCount: sourceIds.length,
    assessmentCounts
  }
}));

process.exitCode = failed ? 1 : 0;

function sourceFetch(plan: SourceCrawlPlan): SourceFetchFunction {
  return routedFetch;
}

function isScopeExclusionCode(value: unknown): boolean {
  return value === "OUT_OF_SCOPE" ||
    value === "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE" ||
    value === "SCOPE_EXCLUDED";
}
