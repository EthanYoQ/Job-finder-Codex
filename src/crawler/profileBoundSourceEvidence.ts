import { getStrictLivzonCeccNetworkPolicy, validateStrictLivzonCeccEvidence } from "./livzonCeccEvidenceVerifier";
import type { NormalizedJobRecord } from "./normalizedJob";
import { validateStrictSinopharmIguopinEvidence } from "./sinopharmIguopinSourceFetch";
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
    case "livzon-cecc":
      return validateStrictLivzonCeccEvidence(plan, evidence, outputJobs);
    case "sinopharm-iguopin":
      return validateStrictSinopharmIguopinEvidence({ plan, evidence, outputJobs });
    case "xinhua-official-announcements":
      return validateStrictXinhuaOfficialAnnouncementReplay(plan, evidence, outputJobs);
  }
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
