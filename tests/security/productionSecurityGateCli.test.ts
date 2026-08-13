import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProductionSecurityGate } from "../../scripts/production-security-gate";
import { createHash } from "node:crypto";
import { createBrowserRuntimeQualificationReceipt } from "../../src/security/browserRuntimeQualification";

const root = resolve(".runtime/.cache/security-gate-test");
const digest = `sha256:${"a".repeat(64)}`;

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("production security gate CLI seam", () => {
  it("writes a committed receipt only when image and lock scanner identities match", async () => {
    const args = fixture(digest);
    await expect(runProductionSecurityGate(args, new Date("2026-08-13T00:00:00Z"))).resolves.toBe(0);
    expect(JSON.parse(readFileSync(args.output, "utf8"))).toMatchObject({
      decision: "PASSED", imageDigest: digest
    });
  });

  it("rejects a clean report belonging to another image", async () => {
    const args = fixture(`sha256:${"b".repeat(64)}`);
    await expect(runProductionSecurityGate({ ...args, imageDigest: digest }, new Date()))
      .rejects.toThrow(/identity|runtime qualification/u);
  });

  it("rejects a stale browser qualification even for the same immutable image", async () => {
    const args = fixture(digest);
    await expect(runProductionSecurityGate(args, new Date("2026-08-13T00:31:00.001Z")))
      .rejects.toThrow(/not fresh/u);
  });
});

function fixture(reportDigest: string) {
  mkdirSync(root, { recursive: true });
  const paths = {
    trivyReport: resolve(root, "trivy.json"), npmAuditReport: resolve(root, "npm.json"),
    npmAuditIdentity: resolve(root, "npm-identity.json"),
    browserRuntimeReport: resolve(root, "browser-runtime.json"),
    packageLock: resolve(root, "package-lock.json"), reachability: resolve(root, "reachability.json"),
    exceptions: resolve(root, "exceptions.json"), output: resolve(root, "receipt.json")
  };
  const lock = Buffer.from(JSON.stringify({ packages: {} }));
  const lockSha = createHash("sha256").update(lock).digest("hex");
  writeFileSync(paths.packageLock, lock);
  writeFileSync(paths.trivyReport, JSON.stringify({ SchemaVersion: 2, ArtifactType: "container_image",
    Metadata: { ImageID: reportDigest }, Results: [] }));
  const audit = Buffer.from(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }));
  const auditSha = createHash("sha256").update(audit).digest("hex");
  writeFileSync(paths.npmAuditReport, audit);
  writeFileSync(paths.npmAuditIdentity, JSON.stringify({
    schemaVersion: 1, packageLockSha256: lockSha, npmAuditSha256: auditSha
  }));
  const browserRaw = Buffer.from(JSON.stringify({
    status: "PASS", executablePath: "/usr/bin/chromium", engineVersion: "151.0.7922.137"
  }));
  const githubRelease = Buffer.from(JSON.stringify({
    tag_name: "v1.93.136", draft: false, prerelease: false, assets: [{
      name: "brave-browser_1.93.136_amd64.deb",
      browser_download_url: "https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb",
      digest: "sha256:9739e5aaee4303eb4199c038b04a75d7bc7ac08314af9f763011e211dea62999"
    }]
  }));
  writeFileSync(paths.browserRuntimeReport, JSON.stringify(createBrowserRuntimeQualificationReceipt(
    browserRaw, githubRelease, reportDigest, new Date("2026-08-13T00:00:00.000Z")
  )));
  writeFileSync(paths.reachability, JSON.stringify({ schemaVersion: 1, decisions: [] }));
  writeFileSync(paths.exceptions, JSON.stringify({ schemaVersion: 1, exceptions: [] }));
  return { imageRef: "job-finder:test", imageDigest: reportDigest, ...paths };
}
