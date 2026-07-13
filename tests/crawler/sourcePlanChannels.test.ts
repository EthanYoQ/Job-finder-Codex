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
  "0beb3022-3214-4333-a2e7-20786c4916d5",
  "623d3b53-0d75-4649-8d4c-df366532fb58"
];

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
  function talentbrewFixture(sourceId: "source-sanofi-china-social" | "source-takeda-china-social") {
    const company = candidateCompanies.find((item) => item.sources.some((source) => source.id === sourceId))!;
    const discovery = getPlanBySourceId(buildDiscoverySourcePlanCandidates([company]), sourceId)!;
    if (discovery.adapterId !== "html-table") throw new Error("Expected a TalentBrew HTML adapter");
    const configuredIds = discovery.table.pagination?.talentbrewScope?.allowedPartitions.map(
      ({ channelId }) => channelId
    );
    if (!configuredIds?.length) throw new Error("Expected configured TalentBrew partitions");
    const surface = expectedOfficialSurfaces.find((item) => item.surfaceId === discovery.source.surfaceId)!;
    return {
      company,
      configuredIds,
      surface: {
        ...surface,
        channels: configuredIds.map((channelId) => ({
          channelId,
          kind: "SOCIAL" as const,
          status: "EXPECTED" as const
        }))
      }
    };
  }

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

  it("binds every configured TalentBrew partition for staged execution while strict remains gated", () => {
    const { company, configuredIds, surface } = talentbrewFixture("source-takeda-china-social");
    const [plan] = buildStagedSourceCrawlPlans([company], [surface]);

    expect(plan?.expectedChannels?.map(({ channelId }) => channelId)).toEqual([...configuredIds].sort());
    expect(plan).toHaveProperty("executionAuthority", "STAGED");
    expect(plan?.expectedChannelSetHash).toBe(expectedChannelSetHash(plan!.expectedChannels!));
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
    expect(buildSourceCrawlPlans([company], [surface])).toEqual([]);
  });

  it.each([
    ["missing", (ids: string[]) => ids.slice(1)],
    ["replacement", (ids: string[]) => ["not-a-configured-partition", ...ids.slice(1)]],
    ["duplicate", (ids: string[]) => [ids[0]!, ids[0]!, ...ids.slice(2)]]
  ])("fails staged planning closed for %s TalentBrew partition coverage", (_label, mutate) => {
    const { company, configuredIds, surface } = talentbrewFixture("source-takeda-china-social");
    const channelIds = mutate(configuredIds);
    const mutated = {
      ...surface,
      channels: channelIds.map((channelId) => ({ channelId, kind: "SOCIAL" as const, status: "EXPECTED" as const }))
    };
    expect(buildStagedSourceCrawlPlans([company], [mutated])).toEqual([]);
  });

  it("fails staged planning closed when a configured channel is not social", () => {
    const { company, surface } = talentbrewFixture("source-sanofi-china-social");
    const mutated = {
      ...surface,
      channels: surface.channels.map((channel, index) =>
        index === 0 ? { ...channel, kind: "CAMPUS" as const } : channel
      )
    };
    expect(buildStagedSourceCrawlPlans([company], [mutated])).toEqual([]);
  });

  it("preserves strict TalentBrew default-channel behavior and unmarked plan shape", () => {
    const sourceId = "source-takeda-china-social";
    const legacyDefaultId = `source:${sourceId}:default`;
    const legacy = resolvedStrictFixture(sourceId, [legacyDefaultId]);
    const [plan] = buildSourceCrawlPlans([legacy.company], [legacy.surface]);

    expect(plan?.expectedChannels).toEqual([{ channelId: legacyDefaultId, kind: "SOCIAL" }]);
    expect(plan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();

    const { configuredIds } = talentbrewFixture(sourceId);
    const stagedOnlyChannels = resolvedStrictFixture(sourceId, configuredIds);
    expect(buildSourceCrawlPlans([stagedOnlyChannels.company], [stagedOnlyChannels.surface])).toEqual([]);
  });

  it("preserves strict ID-only channel comparison for a non-social expected kind", () => {
    const sourceId = "source-astrazeneca-social";
    const fixture = resolvedStrictFixture(sourceId, [`source:${sourceId}:default`], "CAMPUS");
    const [plan] = buildSourceCrawlPlans([fixture.company], [fixture.surface]);

    expect(plan?.expectedChannels).toEqual([{ channelId: `source:${sourceId}:default`, kind: "CAMPUS" }]);
    expect(plan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
  });

  it("preserves strict BEISEN HTML plan emission and legacy validator rejection", () => {
    const sourceId = "source-hansoh-social";
    const fixture = resolvedStrictFixture(sourceId, [`source:${sourceId}:default`]);
    const [strictPlan] = buildSourceCrawlPlans([fixture.company], [fixture.surface]);
    const [stagedPlan] = buildStagedSourceCrawlPlans([fixture.company], [fixture.surface]);

    expect(strictPlan?.adapterId).toBe("html-table");
    expect(strictPlan).not.toHaveProperty("executionAuthority");
    expect(() => validateExecutablePlanChannelBinding(strictPlan!)).toThrow(/adapter does not match ATS kind/);
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

  it("promotes a two-channel surface only when adapter config covers the exact set", () => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    const [plan] = buildSourceCrawlPlans([company], [resolvedCspcSurface()]);
    expect(plan?.expectedChannels?.map((channel) => channel.channelId)).toEqual(channelIds);
    expect(plan?.expectedChannelSetHash).toBe(expectedChannelSetHash(plan!.expectedChannels!));
    expect(() => validateExecutablePlanChannelBinding(plan!)).not.toThrow();
  });

  it.each([
    ["missing", [channelIds[0]!]],
    ["replacement", [channelIds[0]!, "replacement"]],
    ["duplicate", [channelIds[0]!, channelIds[0]!]]
  ])("fails closed for %s channel oracle input", (_label, ids) => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    expect(buildSourceCrawlPlans([company], [resolvedCspcSurface(ids)])).toEqual([]);
  });

  it("hashes channel sets independently of order and changes on replacement", () => {
    const channels = resolvedCspcSurface().channels;
    expect(expectedChannelSetHash(channels)).toBe(expectedChannelSetHash([...channels].reverse()));
    expect(expectedChannelSetHash(channels)).not.toBe(
      expectedChannelSetHash([{ ...channels[0]!, channelId: "replacement" }, channels[1]!])
    );
  });

  it("rejects caller mutation, omitted binding, extras, duplicates and hash substitution", () => {
    const company = candidateCompanies.find((item) => item.id === "company-cspc")!;
    const [plan] = buildSourceCrawlPlans([company], [resolvedCspcSurface()]);
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: plan!.expectedChannels!.slice(0, 1) })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: [...plan!.expectedChannels!, { ...plan!.expectedChannels![0]!, channelId: "extra" }] })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannels: [plan!.expectedChannels![0]!, plan!.expectedChannels![0]!] })).toThrow();
    expect(() => validateExecutablePlanChannelBinding({ ...plan!, expectedChannelSetHash: "0".repeat(64) })).toThrow();
    const { expectedChannels: _channels, expectedChannelSetHash: _hash, ...unbound } = plan!;
    expect(() => validateExecutablePlanChannelBinding(unbound as never)).toThrow();
  });
});
