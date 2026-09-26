import { createLivzonCeccSourceFetch } from "./livzonCeccSourceFetch";
import { createGrifolsChinaSourceFetch } from "./grifolsChinaSourceFetch";
import { createJnjCareersChinaSourceFetch } from "./jnjCareersChinaSourceFetch";
import { createMsdDualOfficialSourceFetch } from "./msdDualOfficialSourceFetch";
import type { SourceFetchFunction } from "./runSourceCrawl";
import { createSinopharmIguopinSourceFetch } from "./sinopharmIguopinSourceFetch";
import { createXinhuaOfficialAnnouncementSourceFetch } from "./xinhuaOfficialAnnouncementSourceFetch";

/**
 * Dispatches the small number of official sources that need a dedicated parser.
 * Company identity, URLs and scope remain in the recruitment profile and the
 * dedicated module; shared scheduling and crawl code only sees this one hook.
 */
export function createProfileBoundSourceFetch(): SourceFetchFunction {
  const delegates = {
    "grifols-china-detail-scope": createGrifolsChinaSourceFetch(),
    "jnj-careers-china": createJnjCareersChinaSourceFetch(),
    "msd-dual-official": createMsdDualOfficialSourceFetch(),
    "livzon-cecc": createLivzonCeccSourceFetch(),
    "sinopharm-iguopin": createSinopharmIguopinSourceFetch(),
    "xinhua-official-announcements": createXinhuaOfficialAnnouncementSourceFetch()
  } as const;

  return (plan) => {
    if (plan.adapterId !== "official-json" || !plan.profileBoundSource) {
      return {
        ok: false,
        capturedAt: new Date().toISOString(),
        failureReason: "PROFILE_BOUND_SOURCE_CONFIG_MISSING"
      };
    }
    const delegate = delegates[plan.profileBoundSource.kind];
    return delegate(plan);
  };
}
