import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertExactPaths,
  validateManifest,
  scanCandidateFiles,
  validateExternalRawArtifactMetadata,
  validateCuratedEvidencePaths,
} from "../../tools/secretEvidencePolicy";

const makeSensitiveAssignment = (value: string) =>
  ["client", "_", "secret", " = ", JSON.stringify(value)].join("");
const makePrivateKeyBlock = (value: string) =>
  ["-----BEGIN ", "PRIVATE KEY-----\n", value, "\n-----END ", "PRIVATE KEY-----"].join("");

describe("candidate secret and evidence policy", () => {
  it("reports only rule/path/count and never the matched value or source line", () => {
    const root = mkdtempSync(join(tmpdir(), "job-finder-secret-redaction-"));
    const marker = ["opaque", "-value-that-must-not-leak"].join("");
    const relativePath = "candidate.ts";
    writeFileSync(join(root, relativePath), makeSensitiveAssignment(marker));

    const result = scanCandidateFiles(root, [relativePath], [relativePath]);
    const rendered = JSON.stringify(result);
    expect(result).toEqual({ ok: false, findings: [{ rule: "secret-assignment", path: relativePath, count: 1 }] });
    expect(rendered).not.toContain(marker);
    expect(rendered).not.toContain(makeSensitiveAssignment(marker));
  });

  it("accepts explicit generated examples but detects private keys and URI userinfo", () => {
    const root = mkdtempSync(join(tmpdir(), "job-finder-secret-fixtures-"));
    writeFileSync(join(root, "safe.ts"), 'const client_secret = "REDACTED";');
    writeFileSync(join(root, "key.ts"), makePrivateKeyBlock("fixture-body"));
    writeFileSync(join(root, "uri.ts"), ["https://opaque-user:", "opaque-pass", "@sensitive.invalid/path"].join(""));
    const result = scanCandidateFiles(root, ["safe.ts", "key.ts", "uri.ts"], ["safe.ts", "key.ts", "uri.ts"]);
    expect(result.findings).toEqual([
      { rule: "private-key-block", path: "key.ts", count: 1 },
      { rule: "uri-userinfo", path: "uri.ts", count: 1 },
    ]);
  });

  it("fails closed on set drift, traversal, symlink, binary NUL, and oversized files", () => {
    const root = mkdtempSync(join(tmpdir(), "job-finder-secret-structure-"));
    writeFileSync(join(root, "ok.ts"), "export {};\n");
    writeFileSync(join(root, "binary.ts"), Buffer.from([0, 1]));
    writeFileSync(join(root, "large.ts"), "x".repeat(65));
    expect(() => assertExactPaths(["ok.ts"], ["ok.ts", "extra.ts"])).toThrow(/unexpected/i);
    expect(() => scanCandidateFiles(root, ["../escape.ts"], ["../escape.ts"])).toThrow(/traversal/i);
    expect(() => scanCandidateFiles(root, ["missing.ts"], ["missing.ts"])).toThrow(/missing/i);
    expect(() => scanCandidateFiles(root, ["binary.ts"], ["binary.ts"])).toThrow(/binary/i);
    writeFileSync(join(root, "utf8.ts"), Buffer.from([0xc3, 0x28]));
    expect(() => scanCandidateFiles(root, ["utf8.ts"], ["utf8.ts"])).toThrow(/UTF-8/i);
    expect(() => scanCandidateFiles(root, ["file.ts:stream"], ["file.ts:stream"])).toThrow(/ADS/i);
    expect(() => scanCandidateFiles(root, ["CON"], ["CON"])).toThrow(/reserved/i);
    expect(() => scanCandidateFiles(root, ["large.ts"], ["large.ts"], { maxBytes: 64 })).toThrow(/size/i);
    try {
      symlinkSync(join(root, "ok.ts"), join(root, "link.ts"));
      expect(() => scanCandidateFiles(root, ["link.ts"], ["link.ts"])).toThrow(/symlink/i);
    } catch (error) {
      if (!(error instanceof Error) || !/privilege|permitted/i.test(error.message)) throw error;
    }
  });

  it("requires curated evidence to equal the exact allowlist and rejects hard-denied forms", () => {
    const allowlist = [".superpowers/sdd/safe-summary.json", ".superpowers/sdd/safe-report.md"];
    expect(() => validateCuratedEvidencePaths(allowlist, allowlist)).not.toThrow();
    expect(() => validateCuratedEvidencePaths(allowlist, [allowlist[0]!])).toThrow(/missing/i);
    expect(() => validateCuratedEvidencePaths(allowlist, [...allowlist, "outputs/raw.stdout"])).toThrow(/unexpected|denied/i);
    expect(() => validateCuratedEvidencePaths(["outputs/run.dump"], ["outputs/run.dump"])).toThrow(/denied/i);
    expect(() => validateCuratedEvidencePaths(["outputs/private-key.pem"], ["outputs/private-key.pem"])).toThrow(/denied/i);
  });

  it("represents external raw artifacts only with safe retrieval metadata", () => {
    const value = { artifactId: "artifact-1", logicalRole: "test-log", sha256: "a".repeat(64), bytes: 42, mediaType: "text-plain", createdAt: "2026-07-12T00:00:00.000Z", storageClass: "ACCESS_CONTROLLED_ARTIFACT_STORE", retentionUntil: "2027-07-12T00:00:00.000Z", retrievalLocatorId: "locator-1", accessPolicy: "RESTRICTED_RELEASE_EVIDENCE", encryption: "AT_REST_AND_IN_TRANSIT", producerCommit: "b".repeat(40), rcId: "p0-rc-20260710-001" };
    expect(() => validateExternalRawArtifactMetadata(value)).not.toThrow();
    expect(() => validateExternalRawArtifactMetadata({ ...value, retrievalLocatorId: "https://example.invalid/?token=x" })).toThrow(/unsafe/i);
    expect(() => validateExternalRawArtifactMetadata({ ...value, raw: "opaque" })).toThrow(/field/i);
    expect(() => validateExternalRawArtifactMetadata({ ...value, retentionUntil: value.createdAt })).toThrow(/binding/i);
    expect(() => validateExternalRawArtifactMetadata({ ...value, storageClass: "other" })).toThrow(/enum/i);
  });

  it("binds a versioned manifest to exact paths, bytes, hashes, roles, base HEAD and plan", () => {
    const bytes = Buffer.from("export {};\n");
    const manifest = { schemaVersion: "phase4-code-candidate-v1" as const, planId: "docs/superpowers/plans/2026-07-10-p0-recovery-and-release-evidence.md", baseHead: "a".repeat(40), entries: [{ path: "src/a.ts", sha256: "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881", bytes: bytes.length, role: "runtime" }] };
    expect(() => validateManifest(manifest, ["src/a.ts"], new Map([["src/a.ts", bytes]]))).not.toThrow();
    expect(() => validateManifest(manifest, ["src/a.ts", "src/b.ts"], new Map([["src/a.ts", bytes]]))).toThrow(/unexpected/i);
  });

  it("audits from tracked config in a checkout without .superpowers and fails closed when config is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "job-finder-evidence-clean-"));
    for (const directory of ["scripts", "tools", "config"]) mkdirSync(join(root, directory), { recursive: true });
    copyFileSync("scripts/audit-phase4-curated-evidence.ts", join(root, "scripts/audit-phase4-curated-evidence.ts"));
    copyFileSync("tools/secretEvidencePolicy.ts", join(root, "tools/secretEvidencePolicy.ts"));
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
    const missing = spawnSync(process.execPath, ["--import", loader, "scripts/audit-phase4-curated-evidence.ts", "--filesystem"], { cwd: root, encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    copyFileSync("config/phase4-task0-evidence-allowlist.json", join(root, "config/phase4-task0-evidence-allowlist.json"));
    const policy = JSON.parse(readFileSync(join(root, "config/phase4-task0-evidence-allowlist.json"), "utf8")) as { paths: string[] };
    for (const path of policy.paths) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), "{}\n"); }
    const output = execFileSync(process.execPath, ["--import", loader, "scripts/audit-phase4-curated-evidence.ts", "--filesystem"], { cwd: root, encoding: "utf8" });
    expect(output).toContain('"staging":"NOT_EVALUATED"');
    expect(output).toContain('"ok":true');
  });
});
