import { describe, expect, it } from "vitest";
import {
  evaluateProductionSecurityGate,
  parseNpmAuditProductionFindings,
  parseTrivyProductionFindings
} from "../../src/security/productionSecurityGate";

const identity = {
  imageRef: "job-finder:test",
  imageDigest: `sha256:${"a".repeat(64)}`,
  packageLockSha256: "b".repeat(64),
  scannerReports: { trivySha256: "c".repeat(64), npmAuditSha256: "d".repeat(64) },
  policyReports: { reachabilitySha256: "e".repeat(64), exceptionsSha256: "f".repeat(64) },
  evaluatedAt: new Date("2026-08-13T00:00:00.000Z")
};

const highFinding = {
  scanner: "TRIVY" as const,
  vulnerabilityId: "CVE-2026-1000",
  packageName: "runtime-parser",
  installedVersion: "1.0.0",
  fixedVersion: "1.0.1",
  severity: "HIGH" as const
};

describe("production security gate", () => {
  it("blocks an unmitigated reachable high vulnerability", () => {
    const receipt = evaluateProductionSecurityGate({
      ...identity,
      findings: [highFinding],
      reachability: [{ packageName: "runtime-parser", state: "REACHABLE", reason: "Imported by the server entrypoint", evidence: "src/server/httpServer.ts", owner: "security@example.com", expiresAt: "2026-09-01T00:00:00.000Z" }],
      exceptions: []
    });

    expect(receipt.decision).toBe("BLOCKED");
    expect(receipt.exitCode).toBe(1);
    expect(receipt.findings[0]).toMatchObject({ runtimeReachability: "REACHABLE", disposition: "BLOCKED" });
  });

  it("allows a high vulnerability proven unreachable from production paths", () => {
    const receipt = evaluateProductionSecurityGate({
      ...identity,
      findings: [highFinding],
      reachability: [{ packageName: "runtime-parser", state: "UNREACHABLE", reason: "Only imported by the build-time renderer", evidence: "vite.config.ts", owner: "security@example.com", expiresAt: "2026-09-01T00:00:00.000Z" }],
      exceptions: []
    });

    expect(receipt.decision).toBe("PASSED");
    expect(receipt.findings[0]).toMatchObject({ runtimeReachability: "UNREACHABLE", disposition: "NON_BLOCKING_UNREACHABLE" });
  });

  it("blocks when a vulnerability exception has expired", () => {
    const receipt = evaluateProductionSecurityGate({
      ...identity,
      findings: [highFinding],
      reachability: [],
      exceptions: [{
        vulnerabilityId: "CVE-2026-1000",
        packageName: "runtime-parser",
        reason: "Upstream patch is scheduled",
        owner: "security@example.com",
        expiresAt: "2026-08-12T23:59:59.000Z"
      }]
    });

    expect(receipt.decision).toBe("BLOCKED");
    expect(receipt.policyErrors).toContain("Expired exception for CVE-2026-1000/runtime-parser");
    expect(receipt.findings[0]?.disposition).toBe("BLOCKED_EXPIRED_EXCEPTION");
  });

  it("normalizes high findings from the image and production lock scanners", () => {
    expect(parseTrivyProductionFindings({ Results: [{ Vulnerabilities: [{
      VulnerabilityID: "CVE-2026-2000", PkgName: "openssl", InstalledVersion: "3.0.0",
      FixedVersion: "3.0.1", Severity: "CRITICAL"
    }] }] })).toEqual([expect.objectContaining({
      scanner: "TRIVY", vulnerabilityId: "CVE-2026-2000", packageName: "openssl",
      installedVersion: "3.0.0", fixedVersion: "3.0.1", severity: "CRITICAL"
    })]);
    expect(parseNpmAuditProductionFindings({ vulnerabilities: { undici: {
      severity: "high", via: [{ severity: "high", url: "https://github.com/advisories/GHSA-test" }]
    } } }, { packages: { "node_modules/undici": { version: "7.28.0" } } })).toEqual([
      expect.objectContaining({ scanner: "NPM_AUDIT", vulnerabilityId: "GHSA-test",
        packageName: "undici", installedVersion: "7.28.0", severity: "HIGH" })
    ]);
  });

  it("treats an unclassified high finding as reachable and blocks it", () => {
    const receipt = evaluateProductionSecurityGate({
      ...identity,
      findings: [highFinding],
      reachability: [],
      exceptions: []
    });
    expect(receipt.findings[0]).toMatchObject({ runtimeReachability: "UNKNOWN", disposition: "BLOCKED" });
    expect(receipt.decision).toBe("BLOCKED");
  });
});
