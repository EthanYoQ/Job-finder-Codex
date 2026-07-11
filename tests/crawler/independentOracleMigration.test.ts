import { describe, expect, it } from "vitest";
import { buildUnsignedOracleV2Migration } from "../../src/crawler/independentOracleMigration";

const legacy = { kind: "FULL_RELEASE", releaseCandidateId: "rc", commitSha: "1".repeat(40),
  rosterSha256: "2".repeat(64), sourcePlanSha256: "3".repeat(64), sourceConfigSha256: "4".repeat(64),
  adapterBundleSha256: "5".repeat(64), authoritativeMembershipDigest: "6".repeat(64),
  producerIdentity: "7".repeat(64), members: [{ companyId: "company", sourceId: "source", surfaceId: "surface",
    channelId: "channel", officialEntryId: "entry", reviewerId: "8".repeat(64), reviewArtifactSha256: "9".repeat(64),
    producerIdentity: "7".repeat(64), reviewerDecision: "APPROVED", reviewerStatus: "INDEPENDENT",
    officialEntrySha256: "a".repeat(64), officialFinalSha256: "b".repeat(64), officialHopChainSha256: "c".repeat(64),
    chinaScope: "RESOLVED", businessUnitScope: "RESOLVED", legalEntityScope: "RESOLVED", channelScope: "RESOLVED",
    adapterId: "official-json", adapterConfigSha256: "d".repeat(64), completenessEvidenceKind: "OFFICIAL_TOTAL",
    completenessEvidenceLocatorSha256: "e".repeat(64), completenessEvidenceContentSha256: "f".repeat(64),
    expectedArtifacts: [{ logicalKey: "page-0", contentSha256: "0".repeat(64) }] }] };

describe("independent oracle unsigned v2 migration", () => {
  it.each([undefined, 1])("converts legacy schema %s only into unsigned canonical payloads", (schemaVersion) => {
    const migrated = buildUnsignedOracleV2Migration({ ...legacy, ...(schemaVersion ? { schemaVersion } : {}) });
    expect(migrated).toMatchObject({ schemaVersion: 2, status: "AWAITING_INDEPENDENT_SIGNATURE",
      reviewSignature: null, hopChainSignature: null });
    expect(migrated.reviewPayload.purpose).toBe("REVIEW");
    expect(migrated.hopChainPayload.purpose).toBe("HOP_CHAIN");
    expect(JSON.stringify(migrated)).not.toContain("PRIVATE KEY");
  });

  it("rejects already-v2, malformed identity, and any supplied signature/private-key material", () => {
    expect(() => buildUnsignedOracleV2Migration({ ...legacy, schemaVersion: 2 })).toThrow(/legacy/i);
    expect(() => buildUnsignedOracleV2Migration({ ...legacy, producerIdentity: "producer" })).toThrow(/SHA/i);
    expect(() => buildUnsignedOracleV2Migration({ ...legacy, signatureBase64: "self-signed" })).toThrow(/signature|private/i);
  });
});
