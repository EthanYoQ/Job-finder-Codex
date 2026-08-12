import { createHash } from "node:crypto";

export const P0_LAUNCH_MANIFEST_SCHEMA_VERSION = "p0-launch-manifest-v1" as const;

export type LaunchCompanyCategory = "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
export type LaunchBatchKind = "FULL_RELEASE" | "SCHEDULED" | "MANUAL_SOURCE" | "BASELINE";

export interface LaunchSourceIdentity {
  sourceId: string;
  surfaceId: string;
  adapterId: "official-json" | "html-table";
}

export interface LaunchCompanyIdentity {
  companyId: string;
  category: LaunchCompanyCategory;
  selectionBasis: "MANDATORY_FOREIGN_PHARMA" | "RC022_TWO_ROUND_STRICT_SUCCESS";
  evidenceRef?: "rc022-two-round-strict-success";
  source: LaunchSourceIdentity;
}

export interface LaunchHistoricalEvidence {
  evidenceId: "rc022-two-round-strict-success";
  releaseCandidateId: "p0-rc-20260717-022";
  cutoffAt: "2026-07-17T17:23:50.827Z";
  roundArtifacts: readonly [
    { path: string; sha256: string; batchId: string },
    { path: string; sha256: string; batchId: string }
  ];
  eligibleDomesticCompanyIds: readonly string[];
}

export interface LaunchManifest {
  schemaVersion: typeof P0_LAUNCH_MANIFEST_SCHEMA_VERSION;
  cohortId: "p0-fixed-50-v1";
  frozenAt: "2026-08-12";
  replacementPolicy: "NO_RUNTIME_REPLACEMENT";
  companies: readonly LaunchCompanyIdentity[];
  historicalEvidence: readonly [LaunchHistoricalEvidence];
}

export interface LaunchRuntimeIdentity {
  batchKind: LaunchBatchKind;
  rosterSha256: string;
  sourcePlanSha256: string;
  expectedPlannedSourceIds: readonly string[];
  expectedPlannedSourceCount: number;
}

export interface LaunchBatchPlanIdentity {
  company: { id: string };
  source: { id: string; surfaceId?: string };
  adapterId: "official-json" | "html-table";
}

export interface HistoricalEvidenceArtifact {
  path: string;
  content: string;
}

const FROZEN_FOREIGN_COMPANY_IDS = [
  "company-johnson-innovative-medicine", "company-abbvie-china", "company-msd-china",
  "company-roche-china", "company-pfizer-china", "company-astrazeneca", "company-novartis",
  "company-bms-china", "company-sanofi-china", "company-novo-nordisk-china",
  "company-lilly-china", "company-gsk-china", "company-amgen-china", "company-takeda-china",
  "company-gilead-china", "company-boehringer-ingelheim-china", "company-bayer-healthcare",
  "company-csl-china", "company-viatris", "company-teva-china", "company-astellas-china",
  "company-daiichi-sankyo-china", "company-sandoz-china", "company-merck-china",
  "company-otsuka-china", "company-biogen-china", "company-grifols-china",
  "company-organon-china", "company-ucb-china", "company-servier-china"
] as const;

const FROZEN_DOMESTIC_COMPANY_IDS = [
  "company-cr-pharma", "company-qilu", "company-grand-pharma", "company-fosun-pharma",
  "company-cspc", "company-hengrui", "company-cttq", "company-shanghai-pharma",
  "company-kelun", "company-xiuzheng", "company-yangzijiang", "company-nhu",
  "company-jimin-kexin", "company-united-lab", "company-tongrentang", "company-livzon",
  "company-buchang", "company-hansoh", "company-lunan", "company-huahai"
] as const;

export const P0_CANDIDATE_COMPANY_IDS = [
  ...FROZEN_FOREIGN_COMPANY_IDS,
  "company-sinopharm", "company-cr-pharma", "company-qilu", "company-grand-pharma",
  "company-fosun-pharma", "company-cspc", "company-hengrui", "company-cttq",
  "company-shanghai-pharma", "company-kelun", "company-xiuzheng", "company-gphl",
  "company-yangzijiang", "company-humanwell", "company-nhu", "company-jimin-kexin",
  "company-united-lab", "company-changchun-high-tech", "company-tongrentang",
  "company-livzon", "company-buchang", "company-hansoh", "company-lunan",
  "company-huahai", "company-north-china-pharma", "company-3sbio", "company-apeloa",
  "company-xinhua-pharma", "company-tianjin-pharma", "company-dongyangguang"
] as const;

const RC022_STRICT_SUCCESS_DOMESTIC_COMPANY_IDS = [
  ...FROZEN_DOMESTIC_COMPANY_IDS,
  "company-3sbio", "company-apeloa", "company-xinhua-pharma",
  "company-tianjin-pharma", "company-dongyangguang"
] as const;

const HTML_TABLE_COMPANY_IDS = new Set<string>([
  "company-abbvie-china", "company-astrazeneca", "company-novartis", "company-sanofi-china",
  "company-takeda-china", "company-boehringer-ingelheim-china", "company-bayer-healthcare",
  "company-csl-china", "company-viatris", "company-teva-china", "company-astellas-china",
  "company-otsuka-china", "company-grand-pharma",
  "company-fosun-pharma", "company-kelun", "company-tongrentang",
  "company-buchang", "company-hansoh", "company-huahai"
]);

export const P0_LAUNCH_MANIFEST: LaunchManifest = {
  schemaVersion: P0_LAUNCH_MANIFEST_SCHEMA_VERSION,
  cohortId: "p0-fixed-50-v1",
  frozenAt: "2026-08-12",
  replacementPolicy: "NO_RUNTIME_REPLACEMENT",
  companies: [
    ...FROZEN_FOREIGN_COMPANY_IDS.map((companyId) => ({
      companyId,
      category: "FOREIGN_PHARMA" as const,
      selectionBasis: "MANDATORY_FOREIGN_PHARMA" as const,
      source: sourceIdentityFor(companyId)
    })),
    ...FROZEN_DOMESTIC_COMPANY_IDS.map((companyId) => ({
      companyId,
      category: "DOMESTIC_PHARMA" as const,
      selectionBasis: "RC022_TWO_ROUND_STRICT_SUCCESS" as const,
      evidenceRef: "rc022-two-round-strict-success" as const,
      source: sourceIdentityFor(companyId)
    }))
  ],
  historicalEvidence: [{
    evidenceId: "rc022-two-round-strict-success",
    releaseCandidateId: "p0-rc-20260717-022",
    cutoffAt: "2026-07-17T17:23:50.827Z",
    roundArtifacts: [
      {
        path: "src/release/evidence/rc022-round1-summary.json",
        sha256: "7a75cc739ea487852851b5b283505f2d9614ccae78b921862e72fbf0fc6d56b0",
        batchId: "eda9ceba-70bd-4e11-8f4b-40a33affdbd2"
      },
      {
        path: "src/release/evidence/rc022-round2-summary.json",
        sha256: "152a9b83bbca6abe70b2918b01f334227bff09f2d7670a42979634107faa7157",
        batchId: "11681c2d-cd2a-421e-83ac-d14872bfbeb3"
      }
    ],
    eligibleDomesticCompanyIds: RC022_STRICT_SUCCESS_DOMESTIC_COMPANY_IDS
  }]
};

export function validateLaunchManifest(
  manifest: LaunchManifest,
  candidateCompanyIds: readonly string[]
): string[] {
  const errors: string[] = [];
  const manifestIds = manifest.companies.map((company) => company.companyId);
  const sourceIds = manifest.companies.map((company) => company.source.sourceId);
  const foreign = manifest.companies.filter((company) => company.category === "FOREIGN_PHARMA");
  const domestic = manifest.companies.filter((company) => company.category === "DOMESTIC_PHARMA");
  const candidateIds = new Set(candidateCompanyIds);
  const evidence = manifest.historicalEvidence[0];

  if (manifest.schemaVersion !== P0_LAUNCH_MANIFEST_SCHEMA_VERSION) errors.push("MANIFEST_SCHEMA_INVALID");
  if (manifest.replacementPolicy !== "NO_RUNTIME_REPLACEMENT") errors.push("REPLACEMENT_POLICY_INVALID");
  if (manifest.companies.length !== 50) errors.push("LAUNCH_COMPANY_COUNT_NOT_50");
  if (new Set(manifestIds).size !== manifestIds.length) errors.push("DUPLICATE_LAUNCH_COMPANY_ID");
  if (new Set(sourceIds).size !== sourceIds.length) errors.push("DUPLICATE_LAUNCH_SOURCE_ID");
  if (foreign.length !== 30) errors.push("LAUNCH_FOREIGN_COMPANY_COUNT_NOT_30");
  if (domestic.length !== 20) errors.push("LAUNCH_DOMESTIC_COMPANY_COUNT_NOT_20");
  if (!sameStringSet(foreign.map((company) => company.companyId), FROZEN_FOREIGN_COMPANY_IDS)) {
    errors.push("MANDATORY_FOREIGN_COMPANY_SET_MISMATCH");
  }

  for (const company of manifest.companies) {
    if (!candidateIds.has(company.companyId)) errors.push(`LAUNCH_COMPANY_MISSING:${company.companyId}`);
    const expectedSource = sourceIdentityFor(company.companyId);
    if (stableJson(company.source) !== stableJson(expectedSource)) {
      errors.push(`LAUNCH_SOURCE_IDENTITY_MISMATCH:${company.companyId}`);
    }
  }
  for (const company of foreign) {
    if (company.selectionBasis !== "MANDATORY_FOREIGN_PHARMA" || company.evidenceRef !== undefined) {
      errors.push(`FOREIGN_SELECTION_BASIS_INVALID:${company.companyId}`);
    }
  }
  const eligibleIds = new Set(evidence.eligibleDomesticCompanyIds);
  for (const company of domestic) {
    if (company.selectionBasis !== "RC022_TWO_ROUND_STRICT_SUCCESS" ||
      company.evidenceRef !== evidence.evidenceId || !eligibleIds.has(company.companyId)) {
      errors.push(`DOMESTIC_SELECTION_EVIDENCE_INVALID:${company.companyId}`);
    }
  }
  return errors;
}

export function launchManifestIdentity(manifest: LaunchManifest) {
  const companyIds = manifest.companies.map((company) => company.companyId).sort(compareUtf8);
  const sourceIdentities = manifest.companies
    .map((company) => ({ companyId: company.companyId, ...company.source }))
    .sort((left, right) => compareUtf8(left.sourceId, right.sourceId));
  return {
    companySetSha256: sha256(JSON.stringify(companyIds)),
    sourceIdentitySha256: sha256(stableJson(sourceIdentities)),
    manifestSha256: sha256(stableJson(manifest))
  };
}

export function validateLaunchBatchIdentity(
  manifest: LaunchManifest,
  identity: LaunchRuntimeIdentity,
  plans: readonly LaunchBatchPlanIdentity[]
): string[] {
  if (identity.batchKind !== "FULL_RELEASE" && identity.batchKind !== "SCHEDULED") return [];
  const errors: string[] = [];
  const manifestIdentity = launchManifestIdentity(manifest);
  const expectedSourceIds = manifest.companies.map((company) => company.source.sourceId);
  if (identity.rosterSha256 !== manifestIdentity.companySetSha256) errors.push("RUNTIME_LAUNCH_ROSTER_MISMATCH");
  if (identity.sourcePlanSha256 !== manifestIdentity.sourceIdentitySha256) {
    errors.push("RUNTIME_LAUNCH_SOURCE_IDENTITY_HASH_MISMATCH");
  }
  if (!sameStringSet(identity.expectedPlannedSourceIds, expectedSourceIds) ||
    identity.expectedPlannedSourceCount !== expectedSourceIds.length ||
    !sameStringSet(plans.map((plan) => plan.source.id), expectedSourceIds)) {
    errors.push("RUNTIME_LAUNCH_SOURCE_SET_MISMATCH");
  }
  const expectedBySource = new Map(manifest.companies.map((company) => [company.source.sourceId, company]));
  for (const plan of plans) {
    const expected = expectedBySource.get(plan.source.id);
    if (!expected || plan.company.id !== expected.companyId ||
      plan.source.surfaceId !== expected.source.surfaceId || plan.adapterId !== expected.source.adapterId) {
      errors.push(`RUNTIME_LAUNCH_SOURCE_IDENTITY_MISMATCH:${plan.source.id}`);
    }
  }
  return errors;
}

export function validateLaunchHistoricalEvidence(
  manifest: LaunchManifest,
  artifacts: readonly HistoricalEvidenceArtifact[]
): string[] {
  const errors: string[] = [];
  const evidence = manifest.historicalEvidence[0];
  const selectedDomesticIds = manifest.companies
    .filter((company) => company.category === "DOMESTIC_PHARMA")
    .map((company) => company.companyId);
  if (artifacts.length !== 2) return ["HISTORICAL_EVIDENCE_ROUND_COUNT_NOT_2"];
  for (const [index, artifact] of artifacts.entries()) {
    const expected = evidence.roundArtifacts[index]!;
    if (artifact.path !== expected.path || sha256(artifact.content) !== expected.sha256) {
      errors.push(`HISTORICAL_EVIDENCE_ARTIFACT_MISMATCH:${index + 1}`);
      continue;
    }
    let summary: Record<string, unknown>;
    try {
      const parsed = JSON.parse(artifact.content) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      summary = parsed as Record<string, unknown>;
    } catch {
      errors.push(`HISTORICAL_EVIDENCE_ROUND_INVALID:${index + 1}`);
      continue;
    }
    if (summary.releaseCandidateId !== evidence.releaseCandidateId) {
      errors.push(`HISTORICAL_EVIDENCE_RELEASE_MISMATCH:${index + 1}`);
    }
    if (summary.batchId !== expected.batchId) errors.push(`HISTORICAL_EVIDENCE_BATCH_MISMATCH:${index + 1}`);
    const failures = summary.consecutiveFailuresByCompany as Record<string, unknown> | undefined;
    for (const companyId of selectedDomesticIds) {
      if (failures?.[companyId] !== 0) errors.push(`HISTORICAL_DOMESTIC_NOT_STRICT_SUCCESS:${index + 1}:${companyId}`);
    }
    if (index === 1 && summary.finishedAt !== evidence.cutoffAt) errors.push("HISTORICAL_EVIDENCE_CUTOFF_MISMATCH");
  }
  return errors;
}

export function selectLaunchCompanies<T extends { id: string }>(
  manifest: LaunchManifest,
  candidateRegistry: readonly T[]
): T[] {
  const byId = new Map(candidateRegistry.map((company) => [company.id, company]));
  return manifest.companies.map(({ companyId }) => {
    const company = byId.get(companyId);
    if (!company) throw new Error(`LAUNCH_COMPANY_MISSING:${companyId}`);
    return company;
  });
}

function sourceIdentityFor(companyId: string): LaunchSourceIdentity {
  const suffix = companyId.replace(/^company-/, "");
  if (companyId === "company-otsuka-china") {
    return { sourceId: "source-otsuka-china-social-2", surfaceId: "surface-otsuka-china-social-2", adapterId: "html-table" };
  }
  return {
    sourceId: `source-${suffix}-social`,
    surfaceId: `surface-${suffix}-social`,
    adapterId: HTML_TABLE_COMPANY_IDS.has(companyId) ? "html-table" : "official-json"
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return left.length === right.length &&
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareUtf8(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
