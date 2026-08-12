import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateProductionSecurityGate,
  parseNpmAuditProductionFindings,
  parseTrivyProductionFindings,
  type ProductionReachabilityDecision,
  type ProductionVulnerabilityException
} from "../src/security/productionSecurityGate";

interface SecurityGateArguments {
  imageRef: string;
  imageDigest: string;
  trivyReport: string;
  npmAuditReport: string;
  npmAuditIdentity: string;
  packageLock: string;
  reachability: string;
  exceptions: string;
  output: string;
}

export async function runProductionSecurityGate(
  args: SecurityGateArguments,
  evaluatedAt = new Date()
): Promise<0 | 1> {
  const [trivyBytes, npmAuditBytes, npmAuditIdentityBytes, packageLockBytes, reachabilityBytes, exceptionsBytes] = await Promise.all([
    readFile(args.trivyReport), readFile(args.npmAuditReport), readFile(args.npmAuditIdentity),
    readFile(args.packageLock), readFile(args.reachability), readFile(args.exceptions)
  ]);
  const trivy = parseJson(trivyBytes, "Trivy report");
  const npmAudit = parseJson(npmAuditBytes, "npm audit report");
  const npmAuditIdentity = parseJson(npmAuditIdentityBytes, "npm audit identity");
  const packageLock = parseJson(packageLockBytes, "package lock");
  const reachability = parsePolicyArray<ProductionReachabilityDecision>(
    parseJson(reachabilityBytes, "reachability policy"), "decisions", "reachability"
  );
  const exceptions = parsePolicyArray<ProductionVulnerabilityException>(
    parseJson(exceptionsBytes, "vulnerability exceptions"), "exceptions", "exceptions"
  );
  await validateAndBindReachabilityEvidence(reachability);
  const packageLockSha256 = sha256(packageLockBytes);
  const receipt = evaluateProductionSecurityGate({
    imageRef: args.imageRef,
    imageDigest: args.imageDigest,
    packageLockSha256,
    scannerReports: {
      trivySha256: sha256(trivyBytes), npmAuditSha256: sha256(npmAuditBytes),
      npmAuditIdentitySha256: sha256(npmAuditIdentityBytes)
    },
    policyReports: {
      reachabilitySha256: sha256(reachabilityBytes), exceptionsSha256: sha256(exceptionsBytes)
    },
    evaluatedAt,
    findings: [
      ...parseTrivyProductionFindings(trivy, args.imageDigest),
      ...parseNpmAuditProductionFindings(
        npmAudit, packageLock, packageLockSha256, sha256(npmAuditBytes), npmAuditIdentity
      )
    ],
    reachability,
    exceptions
  });
  await writeJsonAtomically(args.output, receipt);
  process.stdout.write(`${JSON.stringify({
    decision: receipt.decision,
    findingCount: receipt.findings.length,
    blockedCount: receipt.findings.filter(({ disposition }) => disposition.startsWith("BLOCKED")).length,
    receipt: resolve(args.output),
    contentSha256: receipt.contentSha256
  })}\n`);
  return receipt.exitCode;
}

export function parseProductionSecurityGateArgs(argv: readonly string[]): SecurityGateArguments {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !key.startsWith("--") || value.startsWith("--")) {
      throw new Error("Production security gate arguments must be --name value pairs");
    }
    if (parsed.has(key)) throw new Error(`Duplicate production security argument: ${key}`);
    parsed.set(key, value);
  }
  const read = (name: string) => {
    const value = parsed.get(name);
    if (value === undefined || value.trim().length === 0) throw new Error(`Missing production security argument: ${name}`);
    return value;
  };
  const expected = ["--image-ref", "--image-digest", "--trivy-report", "--npm-audit-report", "--npm-audit-identity",
    "--package-lock", "--reachability", "--exceptions", "--output"];
  for (const key of parsed.keys()) if (!expected.includes(key)) throw new Error(`Unknown production security argument: ${key}`);
  return {
    imageRef: read("--image-ref"), imageDigest: read("--image-digest"),
    trivyReport: read("--trivy-report"), npmAuditReport: read("--npm-audit-report"),
    npmAuditIdentity: read("--npm-audit-identity"),
    packageLock: read("--package-lock"), reachability: read("--reachability"),
    exceptions: read("--exceptions"), output: read("--output")
  };
}

function parseJson(bytes: Buffer, label: string): unknown {
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
}

function parsePolicyArray<T>(value: unknown, field: string, label: string): T[] {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value[field])) {
    throw new Error(`Production ${label} policy is invalid`);
  }
  return value[field] as T[];
}

async function validateAndBindReachabilityEvidence(
  decisions: readonly ProductionReachabilityDecision[]
): Promise<void> {
  const root = resolve(process.cwd());
  for (const decision of decisions) {
    const evidencePath = resolve(root, decision.evidence);
    const pathFromRoot = relative(root, evidencePath);
    if (pathFromRoot.startsWith("..") || resolve(root, pathFromRoot) !== evidencePath) {
      throw new Error(`Reachability evidence escapes the repository: ${decision.evidence}`);
    }
    const evidenceBytes = await readFile(evidencePath);
    if (sha256(evidenceBytes) !== decision.evidenceSha256) {
      throw new Error(`Reachability evidence hash mismatch: ${decision.evidence}`);
    }
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, absolute);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function main(): Promise<void> {
  try { process.exitCode = await runProductionSecurityGate(parseProductionSecurityGateArgs(process.argv.slice(2))); }
  catch (error) {
    console.error(error instanceof Error ? error.message : "Production security gate failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
