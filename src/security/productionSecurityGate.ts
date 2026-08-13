import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PRODUCTION_RUNTIME_OS_FAMILY, PRODUCTION_RUNTIME_OS_NAME } from "../readiness/productionImageContract";

export type ProductionFindingScanner = "TRIVY" | "NPM_AUDIT";
export type ProductionVulnerabilitySeverity = "HIGH" | "CRITICAL";
export type RuntimeReachability = "REACHABLE" | "UNREACHABLE" | "UNKNOWN";

export interface ProductionVulnerabilityFinding {
  scanner: ProductionFindingScanner;
  vulnerabilityId: string;
  packageName: string;
  installedVersion: string;
  fixedVersion?: string;
  severity: ProductionVulnerabilitySeverity;
}

export interface ProductionInstalledPackageIdentity {
  packageName: string;
  version: string;
  architecture: string;
}

export interface ProductionReachabilityDecision {
  scanner: ProductionFindingScanner;
  vulnerabilityId: string;
  packageName: string;
  installedVersion: string;
  state: Exclude<RuntimeReachability, "UNKNOWN">;
  reason: string;
  evidence: string;
  evidenceSha256: string;
  owner: string;
  expiresAt: string;
}

export interface ProductionVulnerabilityException {
  vulnerabilityId: string;
  packageName: string;
  installedVersion?: string;
  reason: string;
  owner: string;
  expiresAt: string;
}

export interface ProductionSecurityGateInput {
  imageRef: string;
  imageDigest: string;
  packageLockSha256: string;
  scannerReports: { trivySha256: string; npmAuditSha256: string; npmAuditIdentitySha256: string;
    browserRuntimeSha256: string; runtimeExposureSha256: string; packageInventorySha256: string };
  policyReports: { reachabilitySha256: string; exceptionsSha256: string };
  evaluatedAt: Date;
  findings: readonly ProductionVulnerabilityFinding[];
  reachability: readonly ProductionReachabilityDecision[];
  exceptions: readonly ProductionVulnerabilityException[];
}

export type ProductionFindingDisposition =
  | "BLOCKED"
  | "BLOCKED_EXPIRED_EXCEPTION"
  | "ACCEPTED_TEMPORARY_EXCEPTION"
  | "NON_BLOCKING_UNREACHABLE";

export interface EvaluatedProductionFinding extends ProductionVulnerabilityFinding {
  runtimeReachability: RuntimeReachability;
  reachabilityReason: string;
  reachabilityEvidence: string | null;
  reachabilityEvidenceSha256: string | null;
  reachabilityOwner: string | null;
  reachabilityExpiresAt: string | null;
  disposition: ProductionFindingDisposition;
  exceptionOwner: string | null;
  exceptionExpiresAt: string | null;
}

export interface ProductionSecurityReceipt {
  schemaVersion: 3;
  decision: "PASSED" | "BLOCKED";
  exitCode: 0 | 1;
  imageRef: string;
  imageDigest: string;
  packageLockSha256: string;
  scannerReports: { trivySha256: string; npmAuditSha256: string; npmAuditIdentitySha256: string;
    browserRuntimeSha256: string; runtimeExposureSha256: string; packageInventorySha256: string };
  policyReports: { reachabilitySha256: string; exceptionsSha256: string };
  evaluatedAt: string;
  findings: EvaluatedProductionFinding[];
  policyErrors: string[];
  contentSha256: string;
}

export async function readProductionSecurityReceipt(path: string): Promise<ProductionSecurityReceipt> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "decision", "exitCode", "imageRef", "imageDigest",
    "packageLockSha256", "scannerReports", "policyReports", "evaluatedAt", "findings", "policyErrors", "contentSha256"]) ||
    value.schemaVersion !== 3 || !["PASSED", "BLOCKED"].includes(String(value.decision)) ||
    ![0, 1].includes(Number(value.exitCode)) || typeof value.imageRef !== "string" || !value.imageRef.trim() ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(value.imageDigest)) || !validShaValue(value.packageLockSha256) ||
    !isRecord(value.scannerReports) || !exactShaRecord(value.scannerReports,
      ["trivySha256", "npmAuditSha256", "npmAuditIdentitySha256", "browserRuntimeSha256", "runtimeExposureSha256",
        "packageInventorySha256"]) ||
    !isRecord(value.policyReports) || !exactShaRecord(value.policyReports, ["reachabilitySha256", "exceptionsSha256"]) ||
    typeof value.evaluatedAt !== "string" || !Number.isFinite(Date.parse(value.evaluatedAt)) ||
    !Array.isArray(value.findings) || !value.findings.every(isEvaluatedFinding) ||
    !Array.isArray(value.policyErrors) || !value.policyErrors.every((error) => typeof error === "string" && error.trim()) ||
    !validShaValue(value.contentSha256)) throw new Error("Production security receipt schema is invalid");
  const { contentSha256, ...base } = value;
  if (createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex") !== contentSha256) {
    throw new Error("Production security receipt content hash mismatch");
  }
  const blocked = value.policyErrors.length > 0 || value.findings.some((finding) =>
    ["BLOCKED", "BLOCKED_EXPIRED_EXCEPTION"].includes(finding.disposition));
  const evaluatedAt = new Date(value.evaluatedAt);
  if (!value.findings.every((finding) => evaluatedFindingIsConsistent(finding, evaluatedAt))) {
    throw new Error("Production security receipt finding relationships are inconsistent");
  }
  if (value.decision !== (blocked ? "BLOCKED" : "PASSED") || value.exitCode !== (blocked ? 1 : 0)) {
    throw new Error("Production security receipt decision is inconsistent");
  }
  return value as unknown as ProductionSecurityReceipt;
}

export function evaluateProductionSecurityGate(
  input: ProductionSecurityGateInput
): ProductionSecurityReceipt {
  validateIdentity(input);
  const evaluatedAt = input.evaluatedAt.toISOString();
  const policyErrors = validatePolicyRecords(input, input.evaluatedAt);
  const reachabilityByFinding = new Map(input.reachability.map((entry) => [findingKey(entry), entry]));
  const findings = input.findings.map((finding): EvaluatedProductionFinding => {
    validateFinding(finding);
    const reachability = reachabilityByFinding.get(findingKey(finding));
    const matchingException = input.exceptions.find((entry) => exceptionMatches(entry, finding));
    const exceptionExpiry = matchingException === undefined ? null : new Date(matchingException.expiresAt);
    const exceptionExpired = exceptionExpiry !== null && exceptionExpiry.getTime() <= input.evaluatedAt.getTime();
    const runtimeReachability = reachability?.state ?? "UNKNOWN";

    let disposition: ProductionFindingDisposition;
    if (runtimeReachability === "UNREACHABLE") {
      disposition = "NON_BLOCKING_UNREACHABLE";
    } else if (matchingException !== undefined && exceptionExpired) {
      disposition = "BLOCKED_EXPIRED_EXCEPTION";
    } else if (matchingException !== undefined) {
      disposition = "ACCEPTED_TEMPORARY_EXCEPTION";
    } else {
      disposition = "BLOCKED";
    }

    return {
      ...finding,
      runtimeReachability,
      reachabilityReason:
        reachability?.reason ?? "No production reachability evidence; policy defaults to reachable",
      reachabilityEvidence: reachability?.evidence ?? null,
      reachabilityEvidenceSha256: reachability?.evidenceSha256 ?? null,
      reachabilityOwner: reachability?.owner ?? null,
      reachabilityExpiresAt: reachability?.expiresAt ?? null,
      disposition,
      exceptionOwner: disposition === "ACCEPTED_TEMPORARY_EXCEPTION" || disposition === "BLOCKED_EXPIRED_EXCEPTION"
        ? matchingException?.owner ?? null : null,
      exceptionExpiresAt: disposition === "ACCEPTED_TEMPORARY_EXCEPTION" || disposition === "BLOCKED_EXPIRED_EXCEPTION"
        ? matchingException?.expiresAt ?? null : null
    };
  });
  const blocked = policyErrors.length > 0 || findings.some((finding) =>
    finding.disposition === "BLOCKED" || finding.disposition === "BLOCKED_EXPIRED_EXCEPTION"
  );
  const base = {
    schemaVersion: 3 as const,
    decision: blocked ? "BLOCKED" as const : "PASSED" as const,
    exitCode: blocked ? 1 as const : 0 as const,
    imageRef: input.imageRef,
    imageDigest: input.imageDigest,
    packageLockSha256: input.packageLockSha256,
    scannerReports: input.scannerReports,
    policyReports: input.policyReports,
    evaluatedAt,
    findings,
    policyErrors
  };
  return {
    ...base,
    contentSha256: createHash("sha256").update(JSON.stringify(base), "utf8").digest("hex")
  };
}

export function parseTrivyProductionFindings(
  value: unknown,
  expectedImageDigest?: string
): ProductionVulnerabilityFinding[] {
  const { results } = parseTrivyProductionOsReport(value, expectedImageDigest);
  const findings: ProductionVulnerabilityFinding[] = [];
  for (const result of results) {
    if (!isRecord(result)) throw new Error("Trivy result is invalid");
    if (result.Vulnerabilities === null || result.Vulnerabilities === undefined) continue;
    if (!Array.isArray(result.Vulnerabilities)) throw new Error("Trivy vulnerabilities are invalid");
    for (const vulnerability of result.Vulnerabilities) {
      if (!isRecord(vulnerability) || !isKnownSeverity(vulnerability.Severity)) {
        throw new Error("Trivy vulnerability severity or schema is invalid");
      }
      if (!isHighSeverity(vulnerability.Severity)) continue;
      const vulnerabilityId = requiredString(vulnerability.VulnerabilityID, "Trivy vulnerability ID");
      const packageName = requiredString(vulnerability.PkgName, "Trivy package name");
      const installedVersion = requiredString(vulnerability.InstalledVersion, "Trivy installed version");
      const fixedVersion = optionalString(vulnerability.FixedVersion);
      findings.push({
        scanner: "TRIVY", vulnerabilityId, packageName, installedVersion,
        ...(fixedVersion === undefined ? {} : { fixedVersion }), severity: vulnerability.Severity
      });
    }
  }
  return findings;
}

export function parseTrivyProductionPackageInventory(
  value: unknown,
  expectedImageDigest?: string
): ProductionInstalledPackageIdentity[] {
  const { osResult } = parseTrivyProductionOsReport(value, expectedImageDigest);
  return (osResult.Packages as unknown[]).map((pkg) => {
    if (!isRecord(pkg)) throw new Error("Trivy production OS package coverage is invalid");
    const packageName = requiredString(pkg.Name, "Trivy production package name");
    const version = requiredString(pkg.Version, "Trivy production package version");
    const architecture = requiredString(pkg.Arch, "Trivy production package architecture");
    const epoch = pkg.Epoch === undefined ? "" : `${nonnegativeInteger(pkg.Epoch, "Trivy production package epoch")}:`;
    const release = pkg.Release === undefined ? "" : `-${requiredString(pkg.Release, "Trivy production package release")}`;
    return { packageName, version: `${epoch}${version}${release}`, architecture };
  }).sort(comparePackageIdentity);
}

function parseTrivyProductionOsReport(value: unknown, expectedImageDigest?: string): {
  results: unknown[];
  osResult: Record<string, unknown>;
} {
  if (!isRecord(value) || value.SchemaVersion !== 2 || value.ArtifactType !== "container_image" ||
    !isRecord(value.Metadata) || !isRecord(value.Metadata.OS) ||
    value.Metadata.OS.Family !== PRODUCTION_RUNTIME_OS_FAMILY || value.Metadata.OS.Name !== PRODUCTION_RUNTIME_OS_NAME ||
    !Array.isArray(value.Results) ||
    (expectedImageDigest !== undefined && value.Metadata.ImageID !== expectedImageDigest)) {
    throw new Error("Trivy report identity or schema is invalid");
  }
  const osResults = value.Results.filter((result) => isRecord(result) && result.Class === "os-pkgs" &&
    result.Type === PRODUCTION_RUNTIME_OS_FAMILY);
  if (osResults.length !== 1 || !Array.isArray(osResults[0]!.Packages) || osResults[0]!.Packages.length === 0 ||
    !osResults[0]!.Packages.every((pkg: unknown) => isRecord(pkg) && typeof pkg.Name === "string" && pkg.Name.trim().length > 0 &&
      typeof pkg.Version === "string" && pkg.Version.trim().length > 0 && typeof pkg.Arch === "string" && pkg.Arch.trim().length > 0)) {
    throw new Error("Trivy production OS package coverage is invalid");
  }
  return { results: value.Results, osResult: osResults[0]! };
}

export function parseNpmAuditProductionFindings(
  value: unknown,
  packageLock: unknown,
  expectedPackageLockSha256?: string,
  expectedNpmAuditSha256?: string,
  reportIdentity?: unknown
): ProductionVulnerabilityFinding[] {
  if (!isRecord(value) || !isRecord(value.vulnerabilities) || !isRecord(packageLock) ||
    value.auditReportVersion !== 2 || !isRecord(packageLock.packages) ||
    (expectedPackageLockSha256 !== undefined && !validNpmAuditIdentity(
      reportIdentity, expectedPackageLockSha256, expectedNpmAuditSha256
    ))) {
    throw new Error("npm audit report or package lock identity is invalid");
  }
  const lockPackages = packageLock.packages;
  const findings: ProductionVulnerabilityFinding[] = [];
  for (const [packageName, aggregate] of Object.entries(value.vulnerabilities)) {
    if (!isRecord(aggregate) || !Array.isArray(aggregate.via) || !Array.isArray(aggregate.nodes) ||
      !isKnownSeverity(aggregate.severity)) {
      throw new Error("npm audit vulnerability is invalid");
    }
    const nodeVersions = aggregate.nodes.map((node) => {
      const nodePath = requiredString(node, "npm audit node");
      const lockEntry = lockPackages[nodePath];
      if (!isRecord(lockEntry)) throw new Error(`npm audit node is absent from lock: ${nodePath}`);
      return requiredString(lockEntry.version, "npm installed version");
    });
    const advisories = aggregate.via.filter((entry) => {
      if (typeof entry === "string") return false;
      if (!isRecord(entry) || !isKnownSeverity(entry.severity)) {
        throw new Error("npm audit advisory is invalid");
      }
      return true;
    }) as Record<string, unknown>[];
    const highAdvisories = advisories.filter((advisory) => isHighSeverity(normalizeSeverity(advisory.severity)));
    if (highAdvisories.length === 0 && isHighSeverity(normalizeSeverity(aggregate.severity))) {
      highAdvisories.push({ severity: aggregate.severity, url: `NPM-AUDIT:${packageName}` });
    }
    if (highAdvisories.length > 0 && nodeVersions.length === 0) {
      throw new Error(`npm audit high vulnerability has no affected nodes: ${packageName}`);
    }
    for (const advisory of highAdvisories) {
      const severity = normalizeSeverity(advisory.severity);
      if (!isHighSeverity(severity)) continue;
      const reference = requiredString(advisory.url, "npm advisory reference");
      for (const installedVersion of new Set(nodeVersions)) findings.push({
        scanner: "NPM_AUDIT", vulnerabilityId: reference.split("/").at(-1) ?? reference,
        packageName, installedVersion, severity
      });
    }
  }
  return findings;
}

function validateIdentity(input: ProductionSecurityGateInput): void {
  if (input.imageRef.trim().length === 0 || !/^sha256:[0-9a-f]{64}$/u.test(input.imageDigest) ||
    !/^[0-9a-f]{64}$/u.test(input.packageLockSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.trivySha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.npmAuditSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.npmAuditIdentitySha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.browserRuntimeSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.runtimeExposureSha256) ||
    !/^[0-9a-f]{64}$/u.test(input.scannerReports.packageInventorySha256) ||
    !/^[0-9a-f]{64}$/u.test(input.policyReports.reachabilitySha256) ||
    !/^[0-9a-f]{64}$/u.test(input.policyReports.exceptionsSha256) ||
    !Number.isFinite(input.evaluatedAt.getTime())) {
    throw new Error("Production security identity is invalid");
  }
}

function validateFinding(finding: ProductionVulnerabilityFinding): void {
  if (finding.vulnerabilityId.trim().length === 0 || finding.packageName.trim().length === 0 ||
    finding.installedVersion.trim().length === 0 || !["HIGH", "CRITICAL"].includes(finding.severity)) {
    throw new Error("Production vulnerability finding is invalid");
  }
}

function validatePolicyRecords(input: ProductionSecurityGateInput, evaluatedAt: Date): string[] {
  const errors: string[] = [];
  const seenReachability = new Set<string>();
  for (const entry of input.reachability) {
    const key = findingKey(entry);
    if (seenReachability.has(key)) errors.push(`Duplicate reachability decision for ${entry.packageName}`);
    seenReachability.add(key);
    const expiry = new Date(entry.expiresAt);
    if (!isFindingIdentity(entry) || entry.reason.trim().length === 0 ||
      entry.evidence.trim().length === 0 || entry.owner.trim().length === 0 ||
      !/^[0-9a-f]{64}$/u.test(entry.evidenceSha256) || !Number.isFinite(expiry.getTime()) ||
      !["REACHABLE", "UNREACHABLE"].includes(entry.state)) {
      errors.push(`Invalid reachability decision for ${entry.packageName || "<empty>"}`);
    } else if (expiry.getTime() <= evaluatedAt.getTime()) {
      errors.push(`Expired reachability decision for ${entry.packageName}`);
    }
  }
  const seenExceptions = new Set<string>();
  for (const entry of input.exceptions) {
    const key = `${entry.vulnerabilityId}\u0000${entry.packageName}\u0000${entry.installedVersion ?? "*"}`;
    if (seenExceptions.has(key)) errors.push(`Duplicate exception for ${entry.vulnerabilityId}/${entry.packageName}`);
    seenExceptions.add(key);
    const expiry = new Date(entry.expiresAt);
    if (entry.vulnerabilityId.trim().length === 0 || entry.packageName.trim().length === 0 ||
      entry.reason.trim().length === 0 || entry.owner.trim().length === 0 || !Number.isFinite(expiry.getTime())) {
      errors.push(`Invalid exception for ${entry.vulnerabilityId || "<empty>"}/${entry.packageName || "<empty>"}`);
    } else if (expiry.getTime() <= evaluatedAt.getTime()) {
      errors.push(`Expired exception for ${entry.vulnerabilityId}/${entry.packageName}`);
    } else {
      const currentFindings = input.findings.filter((finding) => exceptionIdentityMatches(entry, finding));
      if (currentFindings.length === 0) {
        errors.push(`Stale exception does not match the current image for ${entry.vulnerabilityId}/${entry.packageName}`);
      } else if (currentFindings.some((finding) => finding.fixedVersion !== undefined)) {
        errors.push(`Exception is forbidden when a fix is available for ${entry.vulnerabilityId}/${entry.packageName}`);
      }
    }
  }
  return errors;
}

function exceptionMatches(
  entry: ProductionVulnerabilityException,
  finding: ProductionVulnerabilityFinding
): boolean {
  return finding.fixedVersion === undefined && exceptionIdentityMatches(entry, finding);
}

function exceptionIdentityMatches(
  entry: ProductionVulnerabilityException,
  finding: ProductionVulnerabilityFinding
): boolean {
  return entry.vulnerabilityId === finding.vulnerabilityId && entry.packageName === finding.packageName &&
    (entry.installedVersion === undefined || entry.installedVersion === finding.installedVersion);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHighSeverity(value: unknown): value is ProductionVulnerabilitySeverity {
  return value === "HIGH" || value === "CRITICAL";
}

function normalizeSeverity(value: unknown): ProductionVulnerabilitySeverity | "OTHER" {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return isHighSeverity(normalized) ? normalized : "OTHER";
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}
function comparePackageIdentity(left: ProductionInstalledPackageIdentity,
  right: ProductionInstalledPackageIdentity): number {
  return Buffer.from(`${left.packageName}\0${left.version}\0${left.architecture}`, "utf8")
    .compare(Buffer.from(`${right.packageName}\0${right.version}\0${right.architecture}`, "utf8"));
}

function isKnownSeverity(value: unknown): boolean {
  return typeof value === "string" && ["UNKNOWN", "INFO", "LOW", "MEDIUM", "MODERATE", "HIGH", "CRITICAL", "OTHER"]
    .includes(value.toUpperCase());
}

function validNpmAuditIdentity(value: unknown, packageLockSha256: string, npmAuditSha256?: string): boolean {
  return isRecord(value) && value.schemaVersion === 1 &&
    value.packageLockSha256 === packageLockSha256 && value.npmAuditSha256 === npmAuditSha256;
}

function isFindingIdentity(value: Pick<ProductionVulnerabilityFinding,
"scanner" | "vulnerabilityId" | "packageName" | "installedVersion">): boolean {
  return ["TRIVY", "NPM_AUDIT"].includes(value.scanner) && value.vulnerabilityId.trim().length > 0 &&
    value.packageName.trim().length > 0 && value.installedVersion.trim().length > 0;
}

function findingKey(value: Pick<ProductionVulnerabilityFinding,
"scanner" | "vulnerabilityId" | "packageName" | "installedVersion">): string {
  return [value.scanner, value.vulnerabilityId, value.packageName, value.installedVersion].join("\u0000");
}

const validShaValue = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function exactShaRecord(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return exactKeys(value, keys) && keys.every((key) => validShaValue(value[key]));
}
function isEvaluatedFinding(value: unknown): value is EvaluatedProductionFinding {
  if (!isRecord(value)) return false;
  const required = ["scanner", "vulnerabilityId", "packageName", "installedVersion", "severity", "runtimeReachability",
    "reachabilityReason", "reachabilityEvidence", "reachabilityEvidenceSha256", "reachabilityOwner", "reachabilityExpiresAt",
    "disposition", "exceptionOwner", "exceptionExpiresAt"];
  const optional = value.fixedVersion === undefined ? [] : ["fixedVersion"];
  if (!exactKeys(value, [...required, ...optional])) return false;
  return ["TRIVY", "NPM_AUDIT"].includes(String(value.scanner)) && ["HIGH", "CRITICAL"].includes(String(value.severity)) &&
    ["REACHABLE", "UNREACHABLE", "UNKNOWN"].includes(String(value.runtimeReachability)) &&
    ["BLOCKED", "BLOCKED_EXPIRED_EXCEPTION", "ACCEPTED_TEMPORARY_EXCEPTION", "NON_BLOCKING_UNREACHABLE"]
      .includes(String(value.disposition)) &&
    [value.vulnerabilityId, value.packageName, value.installedVersion, value.reachabilityReason]
      .every((entry) => typeof entry === "string" && entry.trim()) &&
    (value.fixedVersion === undefined || typeof value.fixedVersion === "string") &&
    [value.reachabilityEvidence, value.reachabilityOwner, value.reachabilityExpiresAt,
      value.exceptionOwner, value.exceptionExpiresAt].every((entry) => entry === null || typeof entry === "string") &&
    (value.reachabilityEvidenceSha256 === null || validShaValue(value.reachabilityEvidenceSha256));
}
function evaluatedFindingIsConsistent(value: EvaluatedProductionFinding, evaluatedAt: Date): boolean {
  const reachabilityFields = [value.reachabilityEvidence, value.reachabilityEvidenceSha256,
    value.reachabilityOwner, value.reachabilityExpiresAt];
  const hasReachability = reachabilityFields.every((entry) => typeof entry === "string" && entry.length > 0);
  const lacksReachability = reachabilityFields.every((entry) => entry === null);
  const reachabilityExpiry = value.reachabilityExpiresAt === null ? null : new Date(value.reachabilityExpiresAt);
  const reachabilityConsistent = value.runtimeReachability === "UNKNOWN"
    ? lacksReachability && value.disposition !== "NON_BLOCKING_UNREACHABLE"
    : hasReachability && reachabilityExpiry !== null && Number.isFinite(reachabilityExpiry.getTime()) &&
      reachabilityExpiry.getTime() > evaluatedAt.getTime() &&
      (value.runtimeReachability === "UNREACHABLE") === (value.disposition === "NON_BLOCKING_UNREACHABLE");
  const exceptionFields = [value.exceptionOwner, value.exceptionExpiresAt];
  const hasException = exceptionFields.every((entry) => typeof entry === "string" && entry.length > 0);
  const lacksException = exceptionFields.every((entry) => entry === null);
  const exceptionExpiry = value.exceptionExpiresAt === null ? null : new Date(value.exceptionExpiresAt);
  const exceptionConsistent = value.disposition === "ACCEPTED_TEMPORARY_EXCEPTION"
    ? value.fixedVersion === undefined && hasException && exceptionExpiry !== null && Number.isFinite(exceptionExpiry.getTime()) &&
      exceptionExpiry.getTime() > evaluatedAt.getTime()
    : value.disposition === "BLOCKED_EXPIRED_EXCEPTION"
      ? value.fixedVersion === undefined && hasException && exceptionExpiry !== null && Number.isFinite(exceptionExpiry.getTime()) &&
        exceptionExpiry.getTime() <= evaluatedAt.getTime()
      : lacksException;
  return reachabilityConsistent && exceptionConsistent;
}
