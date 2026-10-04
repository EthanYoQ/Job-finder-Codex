import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  P0_CANDIDATE_COMPANY_IDS,
  P0_LAUNCH_MANIFEST,
  launchManifestIdentity,
  selectLaunchCompanies,
  validateLaunchBatchIdentity,
  validateLaunchHistoricalEvidence,
  validateLaunchManifest,
  type LaunchManifest,
  type LaunchRuntimeIdentity
} from "../../src/release/launchManifest";

const EXPECTED_DOMESTIC_COMPANY_IDS = [
  "company-cr-pharma", "company-qilu", "company-grand-pharma", "company-fosun-pharma",
  "company-cspc", "company-hengrui", "company-cttq", "company-shanghai-pharma",
  "company-kelun", "company-united-lab", "company-hansoh"
] as const;

function historicalArtifacts() {
  return P0_LAUNCH_MANIFEST.historicalEvidence[0].roundArtifacts.map(({ path }) => ({
    path,
    content: readFileSync(path, "utf8")
  }));
}

function launchPlans() {
  return P0_LAUNCH_MANIFEST.companies.map((company) => ({
    company: { id: company.companyId },
    source: { id: company.source.sourceId, surfaceId: company.source.surfaceId },
    adapterId: company.source.adapterId
  }));
}

describe("P0 launch manifest", () => {
  it("freezes all 30 foreign companies and 11 manually retained domestic companies", () => {
    const foreignIds = P0_LAUNCH_MANIFEST.companies
      .filter((company) => company.category === "FOREIGN_PHARMA")
      .map((company) => company.companyId);
    const domesticIds = P0_LAUNCH_MANIFEST.companies
      .filter((company) => company.category === "DOMESTIC_PHARMA")
      .map((company) => company.companyId);

    expect(validateLaunchManifest(P0_LAUNCH_MANIFEST, P0_CANDIDATE_COMPANY_IDS)).toEqual([]);
    expect(P0_LAUNCH_MANIFEST.companies).toHaveLength(41);
    expect(foreignIds).toHaveLength(30);
    expect(domesticIds).toEqual(EXPECTED_DOMESTIC_COMPANY_IDS);
  });

  it("keeps the candidate universe separate from the frozen launch cohort", () => {
    const expandedCandidateIds = [...P0_CANDIDATE_COMPANY_IDS, "company-future-foreign-candidate"];
    const expandedCandidates = expandedCandidateIds.map((id) => ({ id }));

    expect(P0_CANDIDATE_COMPANY_IDS).toHaveLength(60);
    expect(validateLaunchManifest(P0_LAUNCH_MANIFEST, expandedCandidateIds)).toEqual([]);
    expect(selectLaunchCompanies(P0_LAUNCH_MANIFEST, expandedCandidates)).toHaveLength(41);
    expect(expandedCandidates.length).toBeGreaterThan(41);
  });

  it("binds both persisted RC022 evidence artifacts and every selected domestic success", () => {
    expect(validateLaunchHistoricalEvidence(P0_LAUNCH_MANIFEST, historicalArtifacts())).toEqual([]);

    const tampered = historicalArtifacts();
    tampered[0] = { ...tampered[0]!, content: tampered[0]!.content.replace(
      '"company-cr-pharma": 0',
      '"company-cr-pharma": 1'
    ) };
    expect(validateLaunchHistoricalEvidence(P0_LAUNCH_MANIFEST, tampered)).toContain(
      "HISTORICAL_EVIDENCE_ARTIFACT_MISMATCH:1"
    );

    const malformed = historicalArtifacts();
    malformed[0] = { ...malformed[0]!, content: "{" };
    const malformedHash = createHash("sha256").update("{", "utf8").digest("hex");
    const manifestWithMalformedArtifact = {
      ...P0_LAUNCH_MANIFEST,
      historicalEvidence: [{
        ...P0_LAUNCH_MANIFEST.historicalEvidence[0],
        roundArtifacts: [
          { ...P0_LAUNCH_MANIFEST.historicalEvidence[0].roundArtifacts[0], sha256: malformedHash },
          P0_LAUNCH_MANIFEST.historicalEvidence[0].roundArtifacts[1]
        ]
      }]
    } as LaunchManifest;
    expect(validateLaunchHistoricalEvidence(manifestWithMalformedArtifact, malformed)).toContain(
      "HISTORICAL_EVIDENCE_ROUND_INVALID:1"
    );
  });

  it("locks deterministic company, source, and whole-manifest identities", () => {
    expect(launchManifestIdentity(P0_LAUNCH_MANIFEST)).toEqual({
      companySetSha256: "ac44a7c7077e23ffa5367dc4bb8a11b254feebc8a190ae7c27481c7269a5a659",
      sourceIdentitySha256: "331cc04ae9fb82aeb8001df41c720d0a308dc1402f63b612dcc924276438e1fc",
      manifestSha256: "51b1d65e0f85835ee91576a181ec6fb34a548c33049df1ca07424101cb43bb01"
    });
  });

  it("fails closed on release roster or source drift without blocking manual diagnostics", () => {
    const plans = launchPlans();
    const manifestIdentity = launchManifestIdentity(P0_LAUNCH_MANIFEST);
    const sourceIds = plans.map((plan) => plan.source.id);
    const identity: LaunchRuntimeIdentity = {
      batchKind: "SCHEDULED",
      rosterSha256: manifestIdentity.companySetSha256,
      sourcePlanSha256: manifestIdentity.sourceIdentitySha256,
      expectedPlannedSourceIds: sourceIds,
      expectedPlannedSourceCount: sourceIds.length
    };

    expect(validateLaunchBatchIdentity(P0_LAUNCH_MANIFEST, identity, plans)).toEqual([]);
    expect(validateLaunchBatchIdentity(
      P0_LAUNCH_MANIFEST,
      { ...identity, rosterSha256: "drifted" },
      plans
    )).toContain("RUNTIME_LAUNCH_ROSTER_MISMATCH");
    expect(validateLaunchBatchIdentity(P0_LAUNCH_MANIFEST, identity, plans.slice(1))).toContain(
      "RUNTIME_LAUNCH_SOURCE_SET_MISMATCH"
    );
    const duplicateAndMissing = [...sourceIds.slice(1), sourceIds[1]!];
    expect(validateLaunchBatchIdentity(
      P0_LAUNCH_MANIFEST,
      { ...identity, expectedPlannedSourceIds: duplicateAndMissing },
      plans
    )).toContain("RUNTIME_LAUNCH_SOURCE_SET_MISMATCH");
    expect(validateLaunchBatchIdentity(
      P0_LAUNCH_MANIFEST,
      { ...identity, batchKind: "MANUAL_SOURCE", rosterSha256: "diagnostic" },
      plans.slice(0, 1)
    )).toEqual([]);
  });

  it.each([
    [
      "wrong company count",
      { ...P0_LAUNCH_MANIFEST, companies: P0_LAUNCH_MANIFEST.companies.slice(1) } as LaunchManifest,
      "LAUNCH_COMPANY_COUNT_NOT_41"
    ],
    [
      "duplicate company",
      {
        ...P0_LAUNCH_MANIFEST,
        companies: [...P0_LAUNCH_MANIFEST.companies.slice(0, -1), P0_LAUNCH_MANIFEST.companies[0]!]
      } as LaunchManifest,
      "DUPLICATE_LAUNCH_COMPANY_ID"
    ],
    [
      "missing mandatory foreign company",
      {
        ...P0_LAUNCH_MANIFEST,
        companies: [
          ...P0_LAUNCH_MANIFEST.companies.slice(1),
          P0_LAUNCH_MANIFEST.companies.find((company) => company.companyId === "company-3sbio") ?? {
            companyId: "company-3sbio",
            category: "DOMESTIC_PHARMA",
            selectionBasis: "RC022_TWO_ROUND_STRICT_SUCCESS",
            evidenceRef: "rc022-two-round-strict-success",
            source: {
              sourceId: "source-3sbio-social",
              surfaceId: "surface-3sbio-social",
              adapterId: "official-json"
            }
          }
        ]
      } as LaunchManifest,
      "MANDATORY_FOREIGN_COMPANY_SET_MISMATCH"
    ]
  ])("rejects %s", (_name, manifest, expectedError) => {
    expect(validateLaunchManifest(manifest, P0_CANDIDATE_COMPANY_IDS)).toContain(expectedError);
  });
});
