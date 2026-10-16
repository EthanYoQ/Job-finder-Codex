import { describe, expect, it } from "vitest";
import { buildUnsignedOracleV2Migration, buildUnsignedOracleV3Migration } from "../../src/crawler/independentOracleMigration";
import { confirmedCompanyRosterV3 } from "../../src/data/confirmedCompanyRosterV3";
import { canonicalPhase1InScopeRosterMembers } from "../../src/data/phase1ScopePolicy";
import { createHash } from "node:crypto";
import {canonicalIndependentOracleMembersSha256,independentCoverageSetSha256,
  independentHopChainProvenanceRootSha256,independentReviewProvenanceRootSha256} from "../../src/crawler/independentSourceSurfaceOracle";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const privateKeyPemMarker=(kind:string)=>[
  "-----BEGIN",kind,["PRI","VATE"].join(""),["K","EY-----"].join("")
].join(" ");

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

const companyAudits=canonicalPhase1InScopeRosterMembers.map(({id:companyId,category})=>({companyId,category,
  status:"NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const,capturedAt:"2026-07-12T00:00:00.000Z",
  officialWebsiteUrl:`https://example.com/${companyId}`,officialWebsiteSha256:sha(`website:${companyId}`),
  officialEntryIds:[],evidenceArtifacts:[{logicalKey:`website/${companyId}`,contentSha256:sha(`evidence:${companyId}`)}],
  reviewerId:"8".repeat(64),reviewArtifactSha256:sha(`review:${companyId}`),producerIdentity:"7".repeat(64),
  reviewerDecision:"APPROVED" as const,reviewerStatus:"INDEPENDENT" as const}));
const emptyLegacy={...legacy,rosterSha256:confirmedCompanyRosterV3.membersSha256,members:[]};
const firstCompany=canonicalPhase1InScopeRosterMembers[0]!;
const linkedCompanyAudits=companyAudits.map((audit,index)=>index===0?{...audit,
  status:"HAS_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" as const,officialEntryIds:["entry"]}:audit);
const categorylessLegacyMember={...legacy.members[0]!,companyId:firstCompany.id};

describe("independent oracle unsigned v3 migration",()=>{
  it("requires the complete independent audit input and rejects all signing material",()=>{
    expect(()=>buildUnsignedOracleV3Migration({legacy:emptyLegacy})).toThrow(/company audit/i);
    expect(()=>buildUnsignedOracleV3Migration({legacy:emptyLegacy,companyAudits:companyAudits.slice(1)})).toThrow(/scope|roster/i);
    for (const companyId of ["company-humanwell", "company-north-china-pharma"]) {
      expect(()=>buildUnsignedOracleV3Migration({legacy:emptyLegacy,companyAudits:[...companyAudits,
        {...companyAudits[0]!,companyId,category:"DOMESTIC_PHARMA"}]}))
        .toThrow(/scope|roster|company/i);
    }
    expect(()=>buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,signatureBase64:"forbidden"},companyAudits})).toThrow(/signature|private/i);
  });

  it("emits unsigned payloads whose legacy oracleMemberSetSha256 field binds combined coverage",()=>{
    const migrated=buildUnsignedOracleV3Migration({legacy:emptyLegacy,companyAudits:[...companyAudits].reverse()});
    expect(migrated).toMatchObject({schemaVersion:3,status:"AWAITING_INDEPENDENT_SIGNATURE",
      reviewSignature:null,hopChainSignature:null});
    expect(migrated.memberSetSha256).not.toBe(migrated.coverageSetSha256);
    expect(migrated.companyAuditSetSha256).not.toBe(migrated.coverageSetSha256);
    expect(migrated.reviewPayload.oracleMemberSetSha256).toBe(migrated.coverageSetSha256);
    expect(migrated.hopChainPayload.oracleMemberSetSha256).toBe(migrated.coverageSetSha256);
    expect(migrated.members).toEqual([]);
    expect(migrated.companyAudits.map(audit=>audit.companyId)).toEqual(
      [...canonicalPhase1InScopeRosterMembers].map(member=>member.id).sort((a,b)=>a.localeCompare(b)));
  });

  it("derives a real category-less legacy member category from its matching company audit",()=>{
    const migrated=buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,members:[categorylessLegacyMember]},
      companyAudits:linkedCompanyAudits});
    expect(migrated.members).toHaveLength(1);
    expect(migrated.members[0]).toMatchObject({companyId:firstCompany.id,category:firstCompany.category});
    expect(migrated.memberSetSha256).toBe(canonicalIndependentOracleMembersSha256(migrated.members));
    expect(migrated.coverageSetSha256).toBe(independentCoverageSetSha256(migrated.companyAudits,migrated.members));
    expect(migrated.reviewProvenanceRootSha256).toBe(independentReviewProvenanceRootSha256(migrated.companyAudits,migrated.members));
    expect(migrated.hopChainProvenanceRootSha256).toBe(independentHopChainProvenanceRootSha256(migrated.companyAudits,migrated.members));
    expect(migrated.reviewPayload.oracleMemberSetSha256).toBe(migrated.coverageSetSha256);
    expect(()=>buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,members:[categorylessLegacyMember]},
      companyAudits:[...linkedCompanyAudits,linkedCompanyAudits[0]!]})).toThrow(/scope|roster|duplicate/i);
    expect(()=>buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,members:[categorylessLegacyMember]},
      companyAudits:linkedCompanyAudits.slice(1)})).toThrow(/scope|roster|missing/i);
    expect(()=>buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,members:[{...categorylessLegacyMember,
      category:firstCompany.category==="FOREIGN_PHARMA"?"DOMESTIC_PHARMA":"FOREIGN_PHARMA"}]},
      companyAudits:linkedCompanyAudits})).toThrow(/category|conflict/i);
  });

  it.each(["RSA","EC","OPENSSH","DSA","ENCRYPTED"].map(privateKeyPemMarker))
  ("rejects neutral-field embedded private-key PEM marker %s",(pem)=>{
    expect(()=>buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,notes:pem},companyAudits}))
      .toThrow(/signature|private-key/i);
  });

  it("returns only explicitly allowlisted legacy/source fields",()=>{
    const migrated=buildUnsignedOracleV3Migration({legacy:{...emptyLegacy,neutralMetadata:"must-not-survive"},
      companyAudits:companyAudits.map((audit,index)=>index===0?{...audit,neutralMetadata:"must-not-survive"}:audit)});
    expect(JSON.stringify(migrated)).not.toContain("neutralMetadata");
    expect(JSON.stringify(migrated)).not.toContain("must-not-survive");
  });
});
