import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY,
  readProductionDeploymentImageReceipt,
  validateProductionDeploymentImage
} from "../../scripts/validate-production-deployment-image";
import { deployQualifiedStack, type DeployQualifiedStackDeps } from "../../scripts/deploy-qualified-stack";

describe("production deployment image", () => {
  it("accepts only the qualified repository at an immutable sha256 digest", () => {
    const digest = "a".repeat(64);
    expect(validateProductionDeploymentImage(digest))
      .toBe(`${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@sha256:${digest}`);
    for (const invalid of [undefined, "", "latest", `sha256:${digest}`, "A".repeat(64)]) {
      expect(() => validateProductionDeploymentImage(invalid)).toThrow(/JOB_FINDER_IMAGE_DIGEST/u);
    }
  });

  it("writes a self-hashed deployment receipt bound to the qualified config digest", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "deployment-image-receipt-"));
    const qualificationPath = resolve(temp, "qualification.json"), output = resolve(temp, "deployment.json");
    const configDigest = `sha256:${"b".repeat(64)}`, manifestDigest = `sha256:${"c".repeat(64)}`;
    const qualificationBase = { schemaVersion: 1, decision: "PASSED", imageDigest: configDigest,
      revision: "d".repeat(40), buildIdentitySha256: "e".repeat(64),
      buildIdentityContentSha256: "f".repeat(64), securityReceiptSha256: "1".repeat(64),
      restoreReceiptSha256: "2".repeat(64), evaluatedAt: "2026-08-13T00:00:00.000Z",
      gates: ["CLEAN_BUILD", "NON_ROOT", "SIZE_BUDGET", "LIVEZ", "EMPTY_DB_BOOTSTRAP",
        "READYZ_FAIL_CLOSED", "REAL_PG16_RESTORE", "PRODUCTION_SECURITY"] };
    const qualification = { ...qualificationBase,
      contentSha256: createHash("sha256").update(JSON.stringify(qualificationBase)).digest("hex") };
    writeFileSync(qualificationPath, JSON.stringify(qualification));
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/write-deployment-image-receipt.ts",
      output, PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY, manifestDigest, configDigest, qualification.revision,
      qualificationPath], { cwd: process.cwd() });
    const receipt = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
    expect(receipt).toMatchObject({ decision: "PASSED",
      image: `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@${manifestDigest}`, configDigest, manifestDigest });
    const { contentSha256, ...base } = receipt;
    expect(contentSha256).toBe(createHash("sha256").update(JSON.stringify(base)).digest("hex"));
    return expect(readProductionDeploymentImageReceipt(output, manifestDigest.slice("sha256:".length)))
      .resolves.toMatchObject({ image: receipt.image, revision: qualification.revision });
  });

  it("rejects a self-hashed but incomplete qualification receipt", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "deployment-image-receipt-invalid-"));
    const qualificationPath = resolve(temp, "qualification.json"), output = resolve(temp, "deployment.json");
    const configDigest = `sha256:${"b".repeat(64)}`;
    const thinBase = { schemaVersion: 1, decision: "PASSED", imageDigest: configDigest,
      revision: "d".repeat(40) };
    writeFileSync(qualificationPath, JSON.stringify({ ...thinBase,
      contentSha256: createHash("sha256").update(JSON.stringify(thinBase)).digest("hex") }));
    expect(() => execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs",
      "scripts/write-deployment-image-receipt.ts", output, PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY,
      `sha256:${"c".repeat(64)}`, configDigest, thinBase.revision, qualificationPath],
    { cwd: process.cwd(), stdio: "pipe" })).toThrow();
  });

  it("rejects a valid receipt when the server env selects another digest", async () => {
    const temp = mkdtempSync(resolve(tmpdir(), "deployment-image-receipt-mismatch-"));
    const path = resolve(temp, "deployment.json"), digest = "c".repeat(64);
    const base = { schemaVersion: 1, decision: "PASSED",
      image: `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@sha256:${digest}`,
      repository: PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY, manifestDigest: `sha256:${digest}`,
      configDigest: `sha256:${"b".repeat(64)}`, revision: "d".repeat(40),
      qualificationReceiptSha256: "e".repeat(64), qualificationContentSha256: "f".repeat(64),
      publishedAt: "2026-08-13T00:00:00.000Z" };
    writeFileSync(path, JSON.stringify({ ...base,
      contentSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex") }));
    await expect(readProductionDeploymentImageReceipt(path, "a".repeat(64)))
      .rejects.toThrow(/does not authorize/u);
  });

  it("forces the receipt-authorized digest over a conflicting host environment", async () => {
    const fixture = writeDeploymentReceiptFixture();
    const calls: Parameters<DeployQualifiedStackDeps["run"]>[0][] = [];
    await deployQualifiedStack(fixture.path, "production.env", ["web"], {
      readEnvFile: () => `JOB_FINDER_IMAGE_DIGEST=${fixture.digest}\n`,
      hostEnv: { JOB_FINDER_IMAGE_DIGEST: "a".repeat(64), PATH: "test-path" },
      run: (command) => { calls.push(command); return { status: 0 }; }
    });
    expect(calls.some((call) => call.args.includes("up"))).toBe(true);
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.options.env.JOB_FINDER_IMAGE_DIGEST).toBe(fixture.digest);
    expect(calls[0]?.args).toEqual(["pull", `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@sha256:${fixture.digest}`]);
  });

  it("never starts services when pull or compose validation fails", async () => {
    for (const failureIndex of [0, 1]) {
      const fixture = writeDeploymentReceiptFixture();
      const calls: Parameters<DeployQualifiedStackDeps["run"]>[0][] = [];
      await expect(deployQualifiedStack(fixture.path, "production.env", [], {
        readEnvFile: () => `JOB_FINDER_IMAGE_DIGEST=${fixture.digest}\n`, hostEnv: {},
        run: (command) => { calls.push(command); return { status: calls.length - 1 === failureIndex ? 1 : 0 }; }
      })).rejects.toThrow(/exited with status 1/u);
      expect(calls.some((call) => call.args.includes("up"))).toBe(false);
    }
  });
});

function writeDeploymentReceiptFixture(): { path: string; digest: string } {
  const temp = mkdtempSync(resolve(tmpdir(), "deployment-image-stack-"));
  const path = resolve(temp, "deployment.json"), digest = "c".repeat(64);
  const base = { schemaVersion: 1, decision: "PASSED",
    image: `${PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY}@sha256:${digest}`,
    repository: PRODUCTION_DEPLOYMENT_IMAGE_REPOSITORY, manifestDigest: `sha256:${digest}`,
    configDigest: `sha256:${"b".repeat(64)}`, revision: "d".repeat(40),
    qualificationReceiptSha256: "e".repeat(64), qualificationContentSha256: "f".repeat(64),
    publishedAt: "2026-08-13T00:00:00.000Z" };
  writeFileSync(path, JSON.stringify({ ...base,
    contentSha256: createHash("sha256").update(JSON.stringify(base)).digest("hex") }));
  return { path, digest };
}
