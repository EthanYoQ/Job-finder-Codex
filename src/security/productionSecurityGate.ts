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
  packageName: string;
  state: Exclude<RuntimeReachability, "UNKNOWN">;
  reason: string;
  evidence: string;
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
  scannerReports: { trivySha256: string; npmAuditSha256: string };
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
  scannerReports: { trivySha256: string; npmAuditSha256: string };
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
  const reachabilityByPackage = new Map(input.reachability.map((entry) => [entry.packageName, entry]));
  const findings = input.findings.map((finding): EvaluatedProductionFinding => {
    validateFinding(finding);
    const reachability = reachabilityByPackage.get(finding.packageName);
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

export function parseTrivyProductionFindings(value: unknown): ProductionVulnerabilityFinding[] {
  if (!isRecord(value) || !Array.isArray(value.Results)) throw new Error("Trivy report is invalid");
  const findings: ProductionVulnerabilityFinding[] = [];
  for (const result of value.Results) {
    if (!isRecord(result) || result.Vulnerabilities === null || result.Vulnerabilities === undefined) continue;
    if (!Array.isArray(result.Vulnerabilities)) throw new Error("Trivy vulnerabilities are invalid");
    for (const vulnerability of result.Vulnerabilities) {
      if (!isRecord(vulnerability) || !isHighSeverity(vulnerability.Severity)) continue;
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
  packageLock: unknown
): ProductionVulnerabilityFinding[] {
  if (!isRecord(value) || !isRecord(value.vulnerabilities) || !isRecord(packageLock) ||
    !isRecord(packageLock.packages)) throw new Error("npm audit report or package lock is invalid");
  const findings: ProductionVulnerabilityFinding[] = [];
  for (const [packageName, aggregate] of Object.entries(value.vulnerabilities)) {
    if (!isRecord(aggregate)) throw new Error("npm audit vulnerability is invalid");
    const lockEntry = packageLock.packages[`node_modules/${packageName}`];
    if (!isRecord(lockEntry)) throw new Error(`npm audit package is absent from lock: ${packageName}`);
    const installedVersion = requiredString(lockEntry.version, "npm installed version");
    const advisories = Array.isArray(aggregate.via) ? aggregate.via.filter(isRecord) : [];
    const highAdvisories = advisories.filter((advisory) => isHighSeverity(normalizeSeverity(advisory.severity)));
    if (highAdvisories.length === 0 && isHighSeverity(normalizeSeverity(aggregate.severity))) {
      highAdvisories.push({ severity: aggregate.severity, url: `NPM-AUDIT:${packageName}` });
    }
    for (const advisory of highAdvisories) {
      const severity = normalizeSeverity(advisory.severity);
      if (!isHighSeverity(severity)) continue;
      const reference = requiredString(advisory.url, "npm advisory reference");
      findings.push({
        scanner: "NPM_AUDIT",
        vulnerabilityId: reference.split("/").at(-1) ?? reference,
        packageName,
        installedVersion,
        severity
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
    if (seenReachability.has(entry.packageName)) errors.push(`Duplicate reachability decision for ${entry.packageName}`);
    seenReachability.add(entry.packageName);
    const expiry = new Date(entry.expiresAt);
    if (entry.packageName.trim().length === 0 || entry.reason.trim().length === 0 ||
      entry.evidence.trim().length === 0 || entry.owner.trim().length === 0 ||
      !Number.isFinite(expiry.getTime()) || !["REACHABLE", "UNREACHABLE"].includes(entry.state)) {
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
