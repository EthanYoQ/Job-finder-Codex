import { describe, expect, it } from "vitest";
import { candidateCompanies, expectedOfficialSurfaces } from "../../src/data/companyRegistry";
import {
  buildDiscoverySourcePlanCandidates,
  buildSourceCrawlPlans,
  buildStagedSourceCrawlPlans,
  expectedChannelSetHash,
  getPlanBySourceId,
  validateExecutablePlanChannelBinding
} from "../../src/crawler/sourcePlan";

const channelIds = [
  "0beb3022-3214-4333-a2e7-20786c4916d5"
];
const campusChannelId = "623d3b53-0d75-4649-8d4c-df366532fb58";

function resolvedCspcSurface(ids = channelIds) {
  const surface = expectedOfficialSurfaces.find((item) => item.surfaceId === "surface-cspc-social")!;
  const evidenceArtifactSha256 = "a".repeat(64);
  return {
    ...surface,
    oracleStatus: "INDEPENDENTLY_VERIFIED" as const,
    legalEntityScope: [{ status: "RESOLVED" as const, value: "石药控股集团有限公司", evidenceArtifactSha256 }],
    businessUnitScope: [{ status: "RESOLVED" as const, value: "医药", evidenceArtifactSha256 }],
    brandScope: [{ status: "RESOLVED" as const, value: "石药", evidenceArtifactSha256 }],
    chinaScope: { status: "RESOLVED" as const, geography: "MAINLAND_CHINA" as const, evidenceArtifactSha256 },
    channels: ids.map((channelId) => ({ channelId, kind: "SOCIAL" as const, status: "EXPECTED" as const }))
  };
}

describe("executable source plan channel binding", () => {
  function resolvedStrictFixture(
    sourceId: string,
    ids: readonly string[],
    kind: "SOCIAL" | "CAMPUS" = "SOCIAL"
  ) {
    const company = candidateCompanies.find((item) => item.sources.some((source) => source.id === sourceId))!;
    const source = company.sources.find((item) => item.id === sourceId)!;
    const surface = expectedOfficialSurfaces.find((item) => item.surfaceId === source.surfaceId)!;
    const evidenceArtifactSha256 = "b".repeat(64);
    return {
      company,
      surface: {
        ...surface,
        oracleStatus: "INDEPENDENTLY_VERIFIED" as const,
        legalEntityScope: [{ status: "RESOLVED" as const, value: "Canonical legal entity", evidenceArtifactSha256 }],
        businessUnitScope: [{ status: "RESOLVED" as const, value: "Canonical business unit", evidenceArtifactSha256 }],
        brandScope: [{ status: "RESOLVED" as const, value: "Canonical brand", evidenceArtifactSha256 }],
        chinaScope: { status: "RESOLVED" as const, geography: "MAINLAND_CHINA" as const, evidenceArtifactSha256 },
        channels: ids.map((channelId) => ({ channelId, kind, status: "EXPECTED" as const }))
      }
    };
  }

  it("uses one canonical China-page channel without hidden TalentBrew job-type partitions", () => {
    const staged = buildStagedSourceCrawlPlans(candidateCompanies);
    for (const sourceId of ["source-sanofi-china-social", "source-takeda-china-social"]) {
      const plan = getPlanBySourceId(staged, sourceId);
      expect(plan?.expectedChannels).toEqual([
        { channelId: `source:${sourceId}:default`, kind: "SOCIAL" }
      ]);
      if (plan?.adapterId !== "html-table") throw new Error("Expected a TalentBrew HTML adapter");
      expect(plan.table.pagination?.talentbrewScope).toBeUndefined();
      expect(() => validateExecutablePlanChannelBinding(plan)).not.toThrow();
    }
  });

  it("binds each new official source to its canonical default social channel", () => {
    const sourceIds = [
      "source-apeloa-social",
      "source-grand-pharma-social",
      "source-huahai-social",
      "source-otsuka-china-social",
      "source-sandoz-china-social"
    ];
    const staged = buildStagedSourceCrawlPlans(candidateCompanies);

    for (const sourceId of sourceIds) {
      const plan = getPlanBySourceId(staged, sourceId);
      expect(plan?.expectedChannels).toEqual([
        { channelId: `source:${sourceId}:default`, kind: "SOCIAL" }
      ]);
      expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
    }
    expect(getPlanBySourceId(staged, "source-otsuka-china-social-2")).toBeUndefined();
  });

  it("preserves strict TalentBrew default-channel behavior and unmarked plan shape", () => {
    const sourceId = "source-takeda-china-social";
    const legacyDefaultId = `source:${sourceId}:default`;
    const legacy = resolvedStrictFixture(sourceId, [legacyDefaultId]);
    const [plan] = buildSourceCrawlPlans([legacy.company], [legacy.surface]);

    expect(plan?.expectedChannels).toEqual([{ channelId: legacyDefaultId, kind: "SOCIAL" }]);
    expect(plan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();

    const stagedPlan = getPlanBySourceId(buildStagedSourceCrawlPlans([legacy.company]), sourceId);
    expect(stagedPlan?.expectedChannels).toEqual([{ channelId: legacyDefaultId, kind: "SOCIAL" }]);
  });

  it("preserves strict ID-only channel comparison for a non-social expected kind", () => {
    const sourceId = "source-astrazeneca-social";
    const fixture = resolvedStrictFixture(sourceId, [`source:${sourceId}:default`], "CAMPUS");
    const [plan] = buildSourceCrawlPlans([fixture.company], [fixture.surface]);

    expect(plan?.expectedChannels).toEqual([{ channelId: `source:${sourceId}:default`, kind: "CAMPUS" }]);
    expect(plan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
  });

  it("emits the current Hansoh Beisen JSON plan through strict and staged planning", () => {
    const sourceId = "source-hansoh-social";
    const fixture = resolvedStrictFixture(sourceId, [`source:${sourceId}:default`]);
    const [strictPlan] = buildSourceCrawlPlans([fixture.company], [fixture.surface]);
    const [stagedPlan] = buildStagedSourceCrawlPlans([fixture.company], [fixture.surface]);

    expect(strictPlan?.adapterId).toBe("official-json");
    expect(strictPlan).toMatchObject({
      officialJsonFetch: { kind: "beisen-zhiye-2022", category: "1" }
    });
    expect(strictPlan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(strictPlan!)).not.toThrow();
    expect(stagedPlan).toHaveProperty("executionAuthority", "STAGED");
    expect(() => validateExecutablePlanChannelBinding(stagedPlan!)).not.toThrow();
  });

  it("does not promote a well-formed unresolved scope entry", () => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    const unresolved = {
      ...resolvedCspcSurface(),
      legalEntityScope: [{ status: "UNRESOLVED" as const, reason: "official legal entity evidence pending" }]
    };
    expect(buildSourceCrawlPlans([company], [unresolved])).toEqual([]);
  });

  it("promotes the social surface only when it contains the configured social channel", () => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    const [plan] = buildSourceCrawlPlans([company], [resolvedCspcSurface()]);
    expect(plan?.expectedChannels?.map((channel) => channel.channelId)).toEqual(channelIds);
    expect(plan?.expectedChannelSetHash).toBe(expectedChannelSetHash(plan!.expectedChannels!));
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
  });

  it.each([
    ["missing", []],
    ["replacement", ["replacement"]],
    ["campus", [campusChannelId]],
    ["duplicate", [channelIds[0]!, channelIds[0]!]]
  ])("fails closed for %s channel oracle input", (_label, ids) => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    expect(buildSourceCrawlPlans([company], [resolvedCspcSurface(ids)])).toEqual([]);
  });

  it("hashes channel sets independently of order and changes on replacement", () => {
    const channels = [
      ...resolvedCspcSurface().channels,
      { channelId: "another-social-channel", kind: "SOCIAL" as const, status: "EXPECTED" as const }
    ];
    expect(expectedChannelSetHash(channels)).toBe(expectedChannelSetHash([...channels].reverse()));
    expect(expectedChannelSetHash(channels)).not.toBe(
      expectedChannelSetHash([{ ...channels[0]!, channelId: "replacement" }, channels[1]!])
    );
  });

  it("rejects caller mutation, omitted binding, extras, duplicates and hash substitution", () => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    const [plan] = buildSourceCrawlPlans([company], [resolvedCspcSurface()]);
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: [] })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: [...plan!.expectedChannels!, { ...plan!.expectedChannels![0]!, channelId: "extra" }] })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: [plan!.expectedChannels![0]!, plan!.expectedChannels![0]!] })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannelSetHash: "0".repeat(64) })).toThrow();
    const { expectedChannels: _channels, expectedChannelSetHash: _hash, ...unbound } = plan!;
    expect(() => validateExecutablePlanChannelBinding(unbound as never)).toThrow();
  });
});
