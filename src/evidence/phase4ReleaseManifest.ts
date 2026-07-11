import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const SHA256 = /^[0-9a-f]{64}$/u;

export interface Phase4ReleaseManifestInput {
  outputRoot: string;
  releaseId: string;
  capturedAt: string;
  commitSha: string;
  hashes: { sourceTree: string; runtimeTree: string; roster: string; plan: string; config: string; adapter: string; oracle: string; membership: string };
  trustedArtifacts: Array<{ kind: "MEMBERSHIP" | "ORACLE"; rawBase64: string; rawSha256: string; contentSha256: string }>;
  formalBatches: Array<{ id: string; sha256: string }>;
  independentQa: Array<{ batchId: string; decision: "PASS"; sha256: string }>;
}

export function serializeBlockedPhase4Manifest(input: Phase4ReleaseManifestInput) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(input.releaseId)) throw new Error("releaseId is not a safe path segment");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input.capturedAt)) throw new Error("capturedAt must be strict UTC milliseconds");
  mkdirSync(input.outputRoot, { recursive: true });
  const outputRoot = realpathSync(input.outputRoot);
  assertSha(input.commitSha, "commit");
  Object.entries(input.hashes).forEach(([name, value]) => assertSha(value, name));
  if (input.trustedArtifacts.length !== 2 || new Set(input.trustedArtifacts.map(x=>x.kind)).size !== 2) throw new Error("exact membership and oracle trusted artifacts are required");
  const artifacts = input.trustedArtifacts.map((artifact) => { assertSha(artifact.rawSha256,"artifact digest");assertSha(artifact.contentSha256,"artifact content digest");const bytes=Buffer.from(artifact.rawBase64,"base64");if(bytes.length<1||bytes.toString("base64")!==artifact.rawBase64||createHash("sha256").update(bytes).digest("hex")!==artifact.rawSha256)throw new Error(`artifact digest mismatch: ${artifact.kind}`);return{kind:artifact.kind,bytes:bytes.length,rawSha256:artifact.rawSha256,contentSha256:artifact.contentSha256}; });
  if (input.formalBatches.length || input.independentQa.length) throw new Error("production Phase4 formal batch promotion is not implemented; BLOCKED skeleton only");
  const manifest = {
    schemaVersion: "phase4-release-manifest-v1",
    releaseId: input.releaseId,
    capturedAt: input.capturedAt,
    git: { head: input.commitSha, commitBound: true as const },
    hashes: input.hashes,
    trustedArtifacts: artifacts,
    formalBatches: input.formalBatches,
    independentQa: input.independentQa,
    release: { status: "BLOCKED" as const, releaseClaim: false as const,
      blockers: ["TWO_FORMAL_BATCHES_NOT_BOUND", "PRODUCTION_ED25519_QA_NOT_BOUND"] },
  };
  const releaseDirectory = join(outputRoot, input.releaseId);
  mkdirSync(releaseDirectory);
  const directory = join(releaseDirectory, input.capturedAt.replace(/[:+]/gu, "-").replace(/\./gu, "-"));
  mkdirSync(directory);
  assertContained(outputRoot, realpathSync(directory), "manifest output");
  const path = join(directory, "manifest.json");
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { path, manifest, input };
}

function assertContained(root: string, candidate: string, label: string): void { const rel=relative(root,candidate);if(!rel||rel===".."||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error(`${label} escapes fixed root`); }

function assertSha(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase sha256 digest`);
}
