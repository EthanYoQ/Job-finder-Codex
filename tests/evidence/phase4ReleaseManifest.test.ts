import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serializeBlockedPhase4Manifest } from "../../src/evidence/phase4ReleaseManifest";

const sha = "a".repeat(64);
const rawBase64=Buffer.from("{}\n").toString("base64"),rawSha256="ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356";
const trusted=()=>[{kind:"MEMBERSHIP" as const,rawBase64,rawSha256,contentSha256:sha},{kind:"ORACLE" as const,rawBase64,rawSha256,contentSha256:sha}];

describe("Phase4 release manifest", () => {
  it("writes a new commit-bound manifest that remains BLOCKED without formal batches and independent QA", () => {
    const root = mkdtempSync(join(tmpdir(), "phase4-manifest-"));
    const artifact = join(root, "trusted.json");
    writeFileSync(artifact, "{}\n");
    const result = serializeBlockedPhase4Manifest({
      outputRoot: root,
      releaseId: "phase4-candidate",
      capturedAt: "2026-07-12T02:00:00.000Z",
      commitSha: sha,
      hashes: { sourceTree: sha, runtimeTree: sha, roster: sha, plan: sha, config: sha, adapter: sha, oracle: sha, membership: sha },
      trustedArtifacts: trusted(),
      formalBatches: [],
      independentQa: [],
    });
    expect(result.manifest.release.status).toBe("BLOCKED");
    expect(result.manifest.git).toEqual({ head: sha, commitBound: true });
    expect(readFileSync(result.path, "utf8")).toContain('"releaseClaim": false');
    expect(() => serializeBlockedPhase4Manifest({ ...result.input })).toThrow(/already exists/i);
  });

  it("rejects an artifact whose trusted digest does not match its bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "phase4-manifest-"));
    const artifact = join(root, "trusted.json");
    writeFileSync(artifact, "{}\n");
    expect(() => serializeBlockedPhase4Manifest({
      outputRoot: root, releaseId: "phase4-candidate", capturedAt: "2026-07-12T02:00:00.000Z", commitSha: sha,
      hashes: { sourceTree: sha, runtimeTree: sha, roster: sha, plan: sha, config: sha, adapter: sha, oracle: sha, membership: sha },
      trustedArtifacts: [{...trusted()[0]!,rawSha256:"b".repeat(64)},trusted()[1]!], formalBatches: [], independentQa: [],
    })).toThrow(/digest/i);
  });
});
