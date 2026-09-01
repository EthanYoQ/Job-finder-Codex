import { getStrictLivzonCeccNetworkPolicy, validateStrictLivzonCeccEvidence } from "./livzonCeccEvidenceVerifier";
import {
  getStrictGrifolsChinaNetworkPolicy,
  isSafeGrifolsChinaFailureCode,
  validateStrictGrifolsChinaEvidence
} from "./grifolsChinaSourceFetch";
import { isSafeJnjCareersFailureCode } from "./jnjCareersChinaSourceFetch";
import {
  getStrictMsdDualOfficialNetworkPolicy,
  isSafeMsdDualOfficialFailureCode,
  validateStrictMsdDualOfficialEvidence
} from "./msdDualOfficialSourceFetch";
import type { NormalizedJobRecord } from "./normalizedJob";
import {
  isSafeSinopharmIguopinFailureCode,
  validateStrictSinopharmIguopinEvidence
} from "./sinopharmIguopinSourceFetch";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence } from "./sourceFetchEvidence";
import { validateStrictXinhuaOfficialAnnouncementReplay } from "./xinhuaOfficialAnnouncementSourceFetch";

export interface ProfileBoundSourceUrlRuleSpec {
  id: string;
  url: string;
  match: "EXACT" | "PATH_PREFIX";
  allowsPagination?: true;
  allowsDeclaration?: true;
  allowsPositiveTotalDeclaration?: true;
}

export interface StrictProfileBoundSourcePolicy {
  urlRules: readonly ProfileBoundSourceUrlRuleSpec[];
  allowPositiveOfficialTotalCountAfterAdapterReconciliation?: true;
  allowIndependentlyVerifiedProfileBoundExclusions?: true;
  allowCompleteTraversalOfEmptyFirstPage?: true;
}

/**
 * Independently replays profile-bound evidence. Each dedicated verifier owns
 * its company's exact source, scope and archive rules; shared crawl code only
 * dispatches on the profile kind.
 */
export function validateStrictProfileBoundSourceEvidence(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[]
): boolean {
  if (plan.adapterId !== "official-json" || !plan.profileBoundSource) return false;
  switch (plan.profileBoundSource.kind) {
    case "grifols-china-detail-scope":
      return validateStrictGrifolsChinaEvidence(plan, evidence, outputJobs);
    case "jnj-careers-china":
      return false;
    case "msd-dual-official":
      return validateStrictMsdDualOfficialEvidence(plan, evidence, outputJobs);
    case "livzon-cecc":
      return validateStrictLivzonCeccEvidence(plan, evidence, outputJobs);
    case "sinopharm-iguopin":
      return validateStrictSinopharmIguopinEvidence({ plan, evidence, outputJobs });
    case "xinhua-official-announcements":
      return validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, outputJobs);
  }
}

/**
 * Converts a raw official total into the persistable displayable total only
 * after the company-specific replay has independently proved every exclusion.
 * The archived declaration and loss ledger retain the original raw total.
 */
export function profileBoundPersistedExpectedJobCount(
  plan: SourceCrawlPlan,
  evidence: PersistentSourceFetchEvidence,
  outputJobs: readonly NormalizedJobRecord[]
): number | undefined {
  if (plan.adapterId !== "official-json" || plan.profileBoundSource?.kind !== "msd-dual-official" ||
      !validateStrictMsdDualOfficialEvidence(plan, evidence, outputJobs)) return undefined;
  const declaration = evidence.declaredCompleteness;
  if (
    declaration?.kind !== "OFFICIAL_TOTAL_COUNT" ||
    declaration.value !== evidence.fetchCounts.rawCount ||
    evidence.fetchCounts.parsedCount !== evidence.fetchCounts.rawCount ||
    evidence.fetchCounts.validCount !== outputJobs.length ||
    evidence.fetchCounts.validCount + evidence.fetchCounts.validationDiscardCount !== declaration.value ||
    evidence.fetchCounts.parseDiscardCount !== 0 ||
    evidence.fetchCounts.validationDiscardCount !== evidence.fetchLosses.length ||
    evidence.fetchLosses.some((loss) =>
      loss.stage !== "VALIDATION" || loss.reason !== "VERIFIED_OFFICIAL_TEST_PLACEHOLDER")
  ) return undefined;
  return evidence.fetchCounts.validCount;
}

/**
 * Returns only network allow-list metadata. Exact company/source binding is
 * still enforced by the independent replay above, so changing a profile cannot
 * manufacture a passing archive around a different tenant or endpoint.
 */
export function getStrictProfileBoundSourcePolicy(
  plan: SourceCrawlPlan
): StrictProfileBoundSourcePolicy | undefined {
  if (plan.adapterId !== "official-json" || !plan.profileBoundSource) return undefined;
  switch (plan.profileBoundSource.kind) {
    case "grifols-china-detail-scope":
      return getStrictGrifolsChinaNetworkPolicy(plan);
    case "jnj-careers-china":
      return undefined;
    case "msd-dual-official":
      return getStrictMsdDualOfficialNetworkPolicy(plan);
    case "livzon-cecc": {
      const policy = getStrictLivzonCeccNetworkPolicy(plan);
      if (!policy) return undefined;
      return {
        urlRules: [
          ...policy.partitionRouteUrls.map((url, index) => ({
            id: `profile-route-${index}`,
            url,
            match: "EXACT" as const
          })),
          {
            id: "profile-list-api",
            url: policy.listApiUrl,
            match: "EXACT",
            allowsPagination: true,
            allowsDeclaration: true,
            allowsPositiveTotalDeclaration: true
          }
        ],
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      };
    }
    case "sinopharm-iguopin": {
      const config = plan.profileBoundSource.config;
      return {
        urlRules: [
          { id: "profile-official-talent-hub", url: config.officialTalentHubUrl, match: "EXACT" },
          { id: "profile-exclusive-info", url: config.exclusiveInfoUrl, match: "EXACT" },
          {
            id: "profile-project-jobs",
            url: config.projectJobsUrl,
            match: "EXACT",
            allowsPagination: true,
            allowsDeclaration: true,
            allowsPositiveTotalDeclaration: true
          }
        ],
        allowPositiveOfficialTotalCountAfterAdapterReconciliation: true
      };
    }
    case "xinhua-official-announcements": {
      const config = plan.profileBoundSource.config;
      return {
        allowCompleteTraversalOfEmptyFirstPage: true,
        urlRules: [{
          id: "profile-official-announcements",
          url: new URL("/SHZP/", config.officialOrigin).toString(),
          match: "PATH_PREFIX",
          allowsPagination: true,
          allowsDeclaration: true
        }]
      };
    }
  }
}

export function safeProfileBoundSourceFailureReason(
  plan: SourceCrawlPlan,
  failureReason: unknown
): string | undefined {
  if (plan.adapterId !== "official-json") return undefined;
  if (
    plan.company.id === "company-grifols-china" &&
    plan.source.id === "source-grifols-china-social" &&
    plan.source.companyId === "company-grifols-china" &&
    plan.profileBoundSource?.kind === "grifols-china-detail-scope" &&
    isSafeGrifolsChinaFailureCode(failureReason)
  ) return failureReason;
  if (
    plan.company.id === "company-johnson-innovative-medicine" &&
    plan.source.id === "source-johnson-innovative-medicine-social" &&
    plan.source.companyId === "company-johnson-innovative-medicine" &&
    plan.profileBoundSource?.kind === "jnj-careers-china" &&
    isSafeJnjCareersFailureCode(failureReason)
  ) return failureReason;
  if (
    plan.company.id === "company-sinopharm" &&
    plan.source.id === "source-sinopharm-social" &&
    plan.source.companyId === "company-sinopharm" &&
    plan.profileBoundSource?.kind === "sinopharm-iguopin" &&
    isSafeSinopharmIguopinFailureCode(failureReason)
  ) return failureReason;
  if (
    plan.company.id === "company-msd-china" &&
    plan.source.id === "source-msd-china-social" &&
    plan.source.companyId === "company-msd-china" &&
    plan.profileBoundSource?.kind === "msd-dual-official" &&
    isSafeMsdDualOfficialFailureCode(failureReason)
  ) return failureReason;
  return undefined;
}
