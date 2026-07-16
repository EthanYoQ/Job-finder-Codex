import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeSourcePlanSha256,
  buildStagedSourceCrawlPlans,
  sourcePlanConfigSha256
} from "../../src/crawler/sourcePlan";
import {
  companyRecruitmentExecutionConfigsBySourceId,
  companyRecruitmentProfiles
} from "../../src/crawler/companyRecruitmentProfiles";
import {
  candidateCompanies,
  companyRosterSha256,
  expectedOfficialSurfaces,
  officialSurfaceOracleSha256
} from "../../src/data/companyRegistry";
import { AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS } from "../../src/data/phase1ScopePolicy";

const BASELINE = {
  rosterSha256: "f59773dae31ab14e1e06c77cc07110ee2657089ae223abdae42112f2bbd2826a",
  surfaceOracleSha256: "dee887449cbde77fc39c13863ea532a8fd69dc6607cc932e6cd12a3098ccfe71",
  stagedPlanSha256: "787320251c04f548769757722cec83a2456db1172be18a5b6a9d06de73c86ed2",
  stagedConfigSetSha256: "bfffa7709b4de83fdd4cba3f4355ba2e28a1a18d9672eba72ddb8a7b497eb3a7"
} as const;

const SHARED_CORE_SOURCE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "officialJsonSourceFetch.ts": [
    "source-novo-nordisk-china-social",
    "source-roche-china-social",
    "source-sandoz-china-social"
  ],
  "workdaySourceFetch.ts": [
    "source-amgen-china-social",
    "source-bms-china-social",
    "source-gilead-china-social",
    "source-johnson-innovative-medicine-social",
    "source-msd-china-social",
    "source-pfizer-china-social"
  ],
  "runSourceCrawl.ts": [
    "source-bms-china-social",
    "source-daiichi-sankyo-china-social",
    "source-grifols-china-social",
    "source-novartis-social",
    "source-roche-china-social"
  ]
};

const SHARED_CORE_COMPANY_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "officialJsonSourceFetch.ts": [
    "company-novo-nordisk-china",
    "company-roche-china",
    "company-sandoz-china"
  ],
  "workdaySourceFetch.ts": [],
  "runSourceCrawl.ts": [
    "company-bms-china",
    "company-daiichi-sankyo-china",
    "company-grifols-china",
    "company-roche-china"
  ]
};

function uniqueMatches(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[0]))].sort();
}

describe("company recruitment profiles", () => {
  it("covers the fixed 60-company directory with unique executable sources", () => {
    const profileCompanyIds = companyRecruitmentProfiles.map(({ companyId }) => companyId);
    const rosterCompanyIds = candidateCompanies.map(({ id }) => id);
    const profileSources = companyRecruitmentProfiles.flatMap(({ sources }) => sources);
    const profileSourceIds = profileSources.map(({ sourceId }) => sourceId);
    const configSourceIds = Object.keys(companyRecruitmentExecutionConfigsBySourceId);
    const stagedSourceIds = buildStagedSourceCrawlPlans(candidateCompanies).map(({ source }) => source.id);

    expect(companyRecruitmentProfiles).toHaveLength(60);
    expect(new Set(profileCompanyIds).size).toBe(60);
    expect([...profileCompanyIds].sort()).toEqual([...rosterCompanyIds].sort());
    expect(profileSources.length).toBeGreaterThan(0);
    expect(new Set(profileSourceIds).size).toBe(profileSources.length);
    expect([...profileSourceIds].sort()).toEqual([...configSourceIds].sort());
    expect([...profileSourceIds].sort()).toEqual([...stagedSourceIds].sort());
  });

  it("keeps authorized exclusions in the directory without executable sources", () => {
    for (const companyId of AUTHORIZED_PHASE1_EXCLUSION_COMPANY_IDS) {
      expect(companyRecruitmentProfiles.find((profile) => profile.companyId === companyId))
        .toMatchObject({ companyId, sources: [] });
    }
  });

  it("binds every source profile explicitly to canonical company, entry, ATS and maintenance policy", () => {
    for (const profile of companyRecruitmentProfiles) {
      const company = candidateCompanies.find(({ id }) => id === profile.companyId)!;
      for (const sourceProfile of profile.sources) {
        const source = company.sources.find(({ id }) => id === sourceProfile.sourceId)!;
        expect(sourceProfile.companyId).toBe(profile.companyId);
        expect(sourceProfile.officialEntryAllowedUrls).toEqual([source.officialEntryUrl]);
        expect(sourceProfile.atsKind).toBe(source.atsKind);
        expect(sourceProfile.chinaSocialScope).toEqual({
          channel: "SOCIAL",
          geography: "MAINLAND_CHINA",
          authority: "OFFICIAL_LINK_OR_EXPLICIT_ENDORSEMENT"
        });
        expect(sourceProfile.completenessStrategy).toMatch(/^(STRICT_OFFICIAL_SOURCE_EVIDENCE|OFFICIAL_HTML_PAGINATION_EVIDENCE|STATIC_PUBLIC_LIST_EXHAUSTION)$/u);
        expect(sourceProfile.failureDisplayStrategy).toBe("VERIFYING_KEEP_OFFICIAL_ENTRY");
        expect(sourceProfile.officialChainVerification.checkedAt).toBe("2026-07-09");
        expect(sourceProfile.officialChainVerification.reason.trim()).not.toBe("");
        expect(Object.isFrozen(profile)).toBe(true);
        expect(Object.isFrozen(sourceProfile)).toBe(true);
        expect(Object.isFrozen(sourceProfile.executionConfig)).toBe(true);
        expect(sourceProfile).not.toHaveProperty("lastSuccessAt");
        expect(sourceProfile).not.toHaveProperty("reasonCode");
        expect(sourceProfile).not.toHaveProperty("state");
      }
    }
  });

  it("preserves the frozen roster, surface, staged plan and every execution config", () => {
    const plans = buildStagedSourceCrawlPlans(candidateCompanies);
    const configHashes = Object.fromEntries(
      plans.map((plan) => [plan.source.id, sourcePlanConfigSha256(plan)]).sort()
    );
    expect(companyRosterSha256(candidateCompanies)).toBe(BASELINE.rosterSha256);
    expect(officialSurfaceOracleSha256(expectedOfficialSurfaces)).toBe(BASELINE.surfaceOracleSha256);
    expect(activeSourcePlanSha256(plans)).toBe(BASELINE.stagedPlanSha256);
    expect(createHash("sha256").update(JSON.stringify(configHashes)).digest("hex"))
      .toBe(BASELINE.stagedConfigSetSha256);
  });

  it("keeps sourcePlan assembly-only and forbids new company constants in shared crawl cores", () => {
    const crawlerRoot = join(process.cwd(), "src", "crawler");
    const sourcePlan = readFileSync(join(crawlerRoot, "sourcePlan.ts"), "utf8");
    expect(sourcePlan).not.toMatch(/const\s+REPRESENTATIVE_CONFIGS/u);
    expect(sourcePlan).not.toMatch(/["']source-[a-z0-9-]+-social(?:-[0-9]+)?["']/u);

    for (const fileName of Object.keys(SHARED_CORE_SOURCE_ALLOWLIST)) {
      const text = readFileSync(join(crawlerRoot, fileName), "utf8");
      expect(uniqueMatches(text, /source-[a-z0-9-]+-social(?:-[0-9]+)?/gu))
        .toEqual([...SHARED_CORE_SOURCE_ALLOWLIST[fileName]!].sort());
      expect(uniqueMatches(text, /company-(?!page\b)[a-z0-9-]+/gu))
        .toEqual([...SHARED_CORE_COMPANY_ALLOWLIST[fileName]!].sort());
    }
  });

  it("keeps dedicated source behavior profile-bound instead of scattering company adapters through shared cores", () => {
    const expectedProfileKinds = new Map([
      ["source-livzon-social", "livzon-cecc"],
      ["source-sinopharm-social", "sinopharm-iguopin"],
      ["source-xinhua-pharma-social", "xinhua-official-announcements"]
    ]);
    for (const [sourceId, expectedKind] of expectedProfileKinds) {
      const config = companyRecruitmentExecutionConfigsBySourceId[sourceId] as {
        profileBoundSource?: { kind?: string };
      } | undefined;
      expect(config?.profileBoundSource?.kind).toBe(expectedKind);
    }

    const crawlerRoot = join(process.cwd(), "src", "crawler");
    for (const fileName of ["sourcePlan.ts", "sourceFetchRouter.ts", "runSourceCrawl.ts"]) {
      const text = readFileSync(join(crawlerRoot, fileName), "utf8");
      expect(text).toContain("profileBoundSource");
      expect(text).not.toMatch(/\b(?:livzonCecc|sinopharmIguopin|xinhuaOfficialAnnouncement)\b/u);
    }
  });
});
