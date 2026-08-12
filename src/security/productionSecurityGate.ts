import { createHash } from "node:crypto";

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
  scannerReports: { trivySha256: string; npmAuditSha256: string; npmAuditIdentitySha256: string };
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
  schemaVersion: 1;
  decision: "PASSED" | "BLOCKED";
  exitCode: 0 | 1;
  imageRef: string;
  imageDigest: string;
  packageLockSha256: string;
  scannerReports: { trivySha256: string; npmAuditSha256: string; npmAuditIdentitySha256: string };
  policyReports: { reachabilitySha256: string; exceptionsSha256: string };
  evaluatedAt: string;
  findings: EvaluatedProductionFinding[];
  policyErrors: string[];
  contentSha256: string;
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
      exceptionOwner: matchingException?.owner ?? null,
      exceptionExpiresAt: matchingException?.expiresAt ?? null
    };
  });
  const blocked = policyErrors.length > 0 || findings.some((finding) =>
    finding.disposition === "BLOCKED" || finding.disposition === "BLOCKED_EXPIRED_EXCEPTION"
  );
  const base = {
    schemaVersion: 1 as const,
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
  if (!isRecord(value) || value.SchemaVersion !== 2 || value.ArtifactType !== "container_image" ||
    !isRecord(value.Metadata) || !Array.isArray(value.Results) ||
    (expectedImageDigest !== undefined && value.Metadata.ImageID !== expectedImageDigest)) {
    throw new Error("Trivy report identity or schema is invalid");
  }
  const findings: ProductionVulnerabilityFinding[] = [];
  for (const result of value.Results) {
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
    if (isHighSeverity(normalizeSeverity(aggregate.severity)) && nodeVersions.length === 0) {
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
    }
  }
  return errors;
}

function exceptionMatches(
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
