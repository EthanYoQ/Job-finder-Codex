import { readFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeBlockedPhase4Manifest } from "../../src/evidence/phase4ReleaseManifest";
import { signedProvenancePayloadSha256 } from "../../src/crawler/reviewerSignatureTrust";
import { buildStructuralArtifacts, fromArtifacts, manifestInput, rebindOuterArtifacts, rebuildStructuralArtifacts }
  from "./helpers/phase4ManifestArtifacts";

const roots: string[] = [];
const temporaryRoot = () => { const root = mkdtempSync(join(tmpdir(), "phase4-manifest-")); roots.push(root); return root; };
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

describe("Phase4 release manifest v2", () => {
  it("emits fixed coverage boundary, exclusions, plan binding, and derived roster/source metrics", () => {
    const result = serializeBlockedPhase4Manifest(manifestInput(temporaryRoot()));

    expect(result.manifest.schemaVersion).toBe("phase4-release-manifest-v2");
    expect(result.manifest.coverageClaim).toEqual({
      boundary: "Completeness covers only social-recruitment jobs reachable at capture time from recruitment entries publicly linked or explicitly endorsed by the target company's official website.",
      excludedPathClasses: [
        "HIDDEN_OR_UNLINKED_ATS_TENANTS", "WECHAT_ONLY_POSTINGS", "THIRD_PARTY_JOB_BOARDS",
        "NOT_PUBLICLY_LINKED_OR_EXPLICITLY_ENDORSED_REGIONAL_LEGAL_ENTITY_BRAND_OR_BUSINESS_UNIT_CHANNELS",
        "OTHER_UNENDORSED_RECRUITMENT_PATHS"
      ],
      noPublicOfficialCareersLinkCompaniesAreCrawlCompletenessBlockers: false
    });
    expect(result.manifest.controllingPlan).toEqual({
      path: "docs/superpowers/plans/2026-07-10-p0-recovery-and-release-evidence.md",
      judgmentUpdatedOn: "2026-07-12", sha256: "2".repeat(64)
    });
    expect(result.manifest.coverage).toEqual({ targetCompanyCount: 60, foreignCompanyCount: 30,
      domesticCompanyCount: 30, hasPublicOfficialCareersLinkCompanyCount: 58,
      noPublicOfficialCareersLinkCompanyCount: 2, auditedOfficialEntryCount: 58,
      uniqueSourceCount: 58, uniqueSurfaceCount: 58, uniqueChannelCount: 58,
      sourceSurfaceChannelMemberTupleCount: 58, blockedOrMissingAuditedOfficialLinkEntryCount: 0 });
    expect(result.manifest.release).toEqual({ status: "BLOCKED", releaseClaim: false,
      blockers: ["TWO_FORMAL_BATCHES_NOT_BOUND", "EXTERNAL_PRODUCTION_SIGNATURE_ACCEPTANCE_QA_NOT_BOUND", "TRUST_FREEZE_ACTIVE"] });
    expect(readFileSync(result.path, "utf8")).toContain('"releaseClaim": false');
  });

  it("keeps create-only output and safe release path behavior", () => {
    const input = manifestInput(temporaryRoot());
    const result = serializeBlockedPhase4Manifest(input);
    expect(() => serializeBlockedPhase4Manifest(input)).toThrow(/already exists/i);
    expect(() => serializeBlockedPhase4Manifest({ ...input, releaseId: "../escape" })).toThrow(/safe path segment/i);
    expect(result.path).toContain("phase4-candidate");
  });

  it("rejects caller-supplied coverage totals or claim text at runtime", () => {
    const input = manifestInput(temporaryRoot()) as any;
    input.targetCompanyCount = 1;
    input.coverageClaimBoundary = "everything";
    expect(() => serializeBlockedPhase4Manifest(input)).toThrow(/unsupported fields/i);
  });

  it.each([
    ["schema drift", (value: any) => { value.oracle.schemaVersion = 2; }],
    ["no-link member", (value: any) => {
      const member = { ...value.oracle.members[0], companyId: value.oracle.companyAudits[0].companyId,
        category: value.oracle.companyAudits[0].category, officialEntryId: "unlinked-entry",
        sourceId: "unlinked-source", surfaceId: "unlinked-surface", channelId: "unlinked-channel" };
      value.oracle.members.push(member);
    }],
    ["has-link missing member", (value: any) => {
      value.oracle.members = value.oracle.members.filter((member: any) =>
        member.companyId !== value.oracle.companyAudits[2].companyId);
    }],
    ["has-link missing entry", (value: any) => { value.oracle.companyAudits[2].officialEntryIds = []; }],
    ["audited entry omitted", (value: any) => { value.oracle.companyAudits[2].officialEntryIds.push("entry-omitted"); }],
    ["member entry absent from audit", (value: any) => { value.oracle.members[0].officialEntryId = "not-audited"; }],
    ["duplicate source ownership", (value: any) => {
      value.oracle.members[1].sourceId = value.oracle.members[0].sourceId;
    }]
  ])("rejects structurally invalid oracle: %s", (_name, mutate) => {
    const artifacts = rebuildStructuralArtifacts(buildStructuralArtifacts(), mutate as any);
    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow();
  });

  it("rejects a duplicate oracle member tuple from the supplied raw bytes", () => {
    const artifacts = buildStructuralArtifacts();
    artifacts.oracle.members.push(structuredClone(artifacts.oracle.members[0]!));
    const tampered = fromArtifacts(artifacts.oracle, artifacts.membership);
    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), tampered))).toThrow(/duplicate/i);
  });

  it.each(["companyAuditSetSha256", "memberSetSha256", "coverageSetSha256", "contentSha256"])(
    "rejects tampered oracle %s", (field) => {
      const artifacts = buildStructuralArtifacts();
      (artifacts.oracle as any)[field] = "0".repeat(64);
      const tampered = fromArtifacts(artifacts.oracle, artifacts.membership);
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), tampered))).toThrow(/hash|digest/i);
    });

  it("rejects missing, extra, or category-drift company audits", () => {
    for (const mutate of [
      (value: any) => value.oracle.companyAudits.pop(),
      (value: any) => value.oracle.companyAudits.push({ ...value.oracle.companyAudits[0], companyId: "company-extra" }),
      (value: any) => { value.oracle.companyAudits[0].category =
        value.oracle.companyAudits[0].category === "FOREIGN_PHARMA" ? "DOMESTIC_PHARMA" : "FOREIGN_PHARMA"; }
    ]) {
      const artifacts = buildStructuralArtifacts();
      mutate(artifacts);
      const tampered = fromArtifacts(artifacts.oracle, artifacts.membership);
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), tampered))).toThrow();
    }
  });

  it.each([
    ["stale", (index: number) => "2026-07-11T01:59:59.999Z"],
    ["exact 24-hour boundary", (index: number) => "2026-07-11T02:00:00.000Z"],
    ["future", (index: number) => "2026-07-12T02:00:00.001Z"],
    ["mixed-age", (index: number) => index === 0 ? "2026-07-11T01:59:59.999Z" : "2026-07-12T00:00:00.000Z"]
  ])("rejects %s company-audit freshness relative to fixed manifest capturedAt", (_name, capturedAtFor) => {
    const artifacts = rebuildStructuralArtifacts(buildStructuralArtifacts(), ({ oracle }) => {
      oracle.companyAudits = oracle.companyAudits.map((audit, index) => ({
        ...audit,
        capturedAt: capturedAtFor(index)
      }));
    });

    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts)))
      .toThrow(/fresh|stale|24|future/i);
  });

  it("rejects raw digest tamper and supplied content digest mismatch", () => {
    const rawTampered = manifestInput(temporaryRoot());
    rawTampered.trustedArtifacts[0]!.rawSha256 = "0".repeat(64);
    expect(() => serializeBlockedPhase4Manifest(rawTampered)).toThrow(/raw digest/i);
    const contentTampered = manifestInput(temporaryRoot());
    contentTampered.trustedArtifacts[1]!.contentSha256 = "0".repeat(64);
    expect(() => serializeBlockedPhase4Manifest(contentTampered)).toThrow(/content digest/i);
  });

  it("rejects membership member projection, member hash, content hash, and roster mismatches", () => {
    const base = buildStructuralArtifacts();
    const mismatch = rebuildStructuralArtifacts(base, (value) => { value.membership.members.pop(); }, false);
    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), mismatch))).toThrow(/member/i);
    for (const field of ["memberSetSha256", "contentSha256", "rosterSha256"] as const) {
      const artifacts = buildStructuralArtifacts();
      (artifacts.membership as any)[field] = "0".repeat(64);
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(),
        fromArtifacts(artifacts.oracle, artifacts.membership)))).toThrow(/hash|digest|roster/i);
    }
  });

  it("rejects non-empty formal batch or independent QA promotion inputs", () => {
    const batch = manifestInput(temporaryRoot());
    batch.formalBatches = [{ id: "batch-1", sha256: "a".repeat(64) }];
    expect(() => serializeBlockedPhase4Manifest(batch)).toThrow(/not implemented/i);
    const qa = manifestInput(temporaryRoot());
    qa.independentQa = [{ batchId: "batch-1", decision: "PASS", sha256: "b".repeat(64) }];
    expect(() => serializeBlockedPhase4Manifest(qa)).toThrow(/not implemented/i);
  });

  it.each(["REVIEW", "HOP_CHAIN"] as const)(
    "recomputes and rejects drifted %s provenance roots after all outer bindings are refreshed", (purpose) => {
      const artifacts = rebindOuterArtifacts(buildStructuralArtifacts(), ({ oracle, membership }) => {
        const root = "0".repeat(64);
        if (purpose === "REVIEW") {
          oracle.reviewProvenanceRootSha256 = root;
          oracle.reviewProvenanceSignature.payload.provenanceRootSha256 = root;
          membership.oracleAuthority.reviewProvenanceRootSha256 = root;
          membership.oracleAuthority.reviewSignedPayloadSha256 =
            signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload);
        } else {
          oracle.hopChainProvenanceRootSha256 = root;
          oracle.hopChainProvenanceSignature.payload.provenanceRootSha256 = root;
          membership.oracleAuthority.hopChainProvenanceRootSha256 = root;
          membership.oracleAuthority.hopChainSignedPayloadSha256 =
            signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload);
        }
      });
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/provenance root/i);
    });

  it.each([
    ["review schema", (oracle: any) => { oracle.reviewProvenanceSignature.payload.schemaVersion = 2; }, "REVIEW"],
    ["hop schema", (oracle: any) => { oracle.hopChainProvenanceSignature.payload.schemaVersion = 2; }, "HOP_CHAIN"],
    ["review purpose", (oracle: any) => { oracle.reviewProvenanceSignature.payload.purpose = "HOP_CHAIN"; }, "REVIEW"],
    ["hop purpose", (oracle: any) => { oracle.hopChainProvenanceSignature.payload.purpose = "REVIEW"; }, "HOP_CHAIN"],
    ["review root", (oracle: any) => { oracle.reviewProvenanceSignature.payload.provenanceRootSha256 = "0".repeat(64); }, "REVIEW"],
    ["hop root", (oracle: any) => { oracle.hopChainProvenanceSignature.payload.provenanceRootSha256 = "0".repeat(64); }, "HOP_CHAIN"],
    ["authoritative membership", (oracle: any) => {
      oracle.reviewProvenanceSignature.payload.authoritativeMembershipDigest = "0".repeat(64);
    }, "REVIEW"],
    ["hop authoritative membership", (oracle: any) => {
      oracle.hopChainProvenanceSignature.payload.authoritativeMembershipDigest = "0".repeat(64);
    }, "HOP_CHAIN"],
    ["coverage", (oracle: any) => { oracle.reviewProvenanceSignature.payload.oracleMemberSetSha256 = "0".repeat(64); }, "REVIEW"],
    ["hop coverage", (oracle: any) => {
      oracle.hopChainProvenanceSignature.payload.oracleMemberSetSha256 = "0".repeat(64);
    }, "HOP_CHAIN"],
    ["producer identity", (oracle: any) => {
      oracle.reviewProvenanceSignature.payload.producerIdentitySha256 = "0".repeat(64);
    }, "REVIEW"],
    ["hop producer identity", (oracle: any) => {
      oracle.hopChainProvenanceSignature.payload.producerIdentitySha256 = "0".repeat(64);
    }, "HOP_CHAIN"],
    ["reviewer identity", (oracle: any) => {
      oracle.reviewProvenanceSignature.payload.reviewerIdentitySha256 = "0".repeat(64);
    }, "REVIEW"],
    ["hop reviewer identity", (oracle: any) => {
      oracle.hopChainProvenanceSignature.payload.reviewerIdentitySha256 = "0".repeat(64);
    }, "HOP_CHAIN"]
  ])("rejects envelope payload drift: %s", (_name, mutate, purpose) => {
    const artifacts = rebindOuterArtifacts(buildStructuralArtifacts(), ({ oracle, membership }) => {
      mutate(oracle);
      if (purpose === "REVIEW" && oracle.reviewProvenanceSignature.payload.schemaVersion === 1) {
        membership.oracleAuthority.reviewSignedPayloadSha256 =
          signedProvenancePayloadSha256(oracle.reviewProvenanceSignature.payload);
      } else if (purpose === "HOP_CHAIN" && oracle.hopChainProvenanceSignature.payload.schemaVersion === 1) {
        membership.oracleAuthority.hopChainSignedPayloadSha256 =
          signedProvenancePayloadSha256(oracle.hopChainProvenanceSignature.payload);
      }
    });
    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/payload|reviewer/i);
  });

  it.each(["reviewKeyId", "hopChainKeyId"] as const)(
    "rejects membership authority %s drift after membership content is refreshed", (field) => {
      const artifacts = rebindOuterArtifacts(buildStructuralArtifacts(), ({ membership }) => {
        membership.oracleAuthority[field] = "different-key";
      });
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/key/i);
    });

  it.each(["reviewSignedPayloadSha256", "hopChainSignedPayloadSha256"] as const)(
    "rejects membership authority %s drift after membership content is refreshed", (field) => {
      const artifacts = rebindOuterArtifacts(buildStructuralArtifacts(), ({ membership }) => {
        membership.oracleAuthority[field] = "0".repeat(64);
      });
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/payload digest/i);
    });

  it.each(["companyId", "sourceId", "surfaceId", "channelId", "officialEntryId"] as const)(
    "rejects raw oracle tuple %s with leading or trailing whitespace", (field) => {
      const artifacts = rebuildStructuralArtifacts(buildStructuralArtifacts(), ({ oracle }) => {
        (oracle.members[0] as any)[field] = ` ${oracle.members[0]![field]} `;
      }, true, true);
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/canonical/i);
    });

  it("rejects NFC-equivalent source aliases before ownership and count projection", () => {
    const artifacts = rebuildStructuralArtifacts(buildStructuralArtifacts(), ({ oracle }) => {
      oracle.members[0]!.sourceId = "shared-source-e\u0301";
      oracle.members[1]!.sourceId = "shared-source-é";
    });
    expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/canonical|ownership/i);
  });

  it.each(["companyId", "sourceId", "surfaceId", "channelId", "officialEntryId"] as const)(
    "rejects NFC-equivalent oracle tuple aliases for %s", (field) => {
      const artifacts = rebuildStructuralArtifacts(buildStructuralArtifacts(), ({ oracle }) => {
        const aliasPeer = field === "companyId"
          ? oracle.members.findIndex((member, index) => index > 0 && member.category === oracle.members[0]!.category)
          : 1;
        (oracle.members[0] as any)[field] = "tuple-alias-e\u0301";
        (oracle.members[aliasPeer] as any)[field] = "tuple-alias-é";
      }, true, true);
      expect(() => serializeBlockedPhase4Manifest(manifestInput(temporaryRoot(), artifacts))).toThrow(/canonical/i);
    });
});
