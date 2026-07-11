import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IndependentSourceSurfaceOracleArtifact } from "./independentSourceSurfaceOracle";

export interface StartupTrustedSourceSurfaceOracle {
  readonly artifact: IndependentSourceSurfaceOracleArtifact;
  readonly rawFileSha256: string;
  readonly rawFileBase64: string;
}
const startupPath = process.env.P0_FULL_RELEASE_ORACLE_FILE;
const startupSha256 = process.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256;
delete process.env.P0_FULL_RELEASE_ORACLE_FILE;
delete process.env.P0_FULL_RELEASE_ORACLE_FILE_SHA256;
const snapshot = Object.freeze({ path: startupPath, sha256: startupSha256 });
const trusted = new WeakSet<object>();
let loaded: Promise<StartupTrustedSourceSurfaceOracle> | undefined;

export function getStartupSourceSurfaceOracle(): Promise<StartupTrustedSourceSurfaceOracle> {
  loaded ??= load(); return loaded;
}
export function assertStartupTrustedSourceSurfaceOracle(value: StartupTrustedSourceSurfaceOracle | undefined):
  asserts value is StartupTrustedSourceSurfaceOracle {
  if (!value || !trusted.has(value)) throw new Error("Source/surface oracle is not trusted by startup authority");
}
async function load(): Promise<StartupTrustedSourceSurfaceOracle> {
  if (!snapshot.path || !snapshot.sha256 || !/^[a-f0-9]{64}$/.test(snapshot.sha256)) {
    throw new Error("FULL_RELEASE startup source/surface oracle authority is unavailable");
  }
  const bytes = await readFile(snapshot.path);
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(snapshot.sha256, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Startup source/surface oracle raw-file digest mismatch");
  }
  const artifact = JSON.parse(bytes.toString("utf8")) as IndependentSourceSurfaceOracleArtifact;
  for (const member of artifact.members) { member.expectedArtifacts.forEach(Object.freeze);
    Object.freeze(member.expectedArtifacts); Object.freeze(member); }
  if (artifact.reviewProvenanceSignature) {
    Object.freeze(artifact.reviewProvenanceSignature.payload); Object.freeze(artifact.reviewProvenanceSignature);
  }
  if (artifact.hopChainProvenanceSignature) {
    Object.freeze(artifact.hopChainProvenanceSignature.payload); Object.freeze(artifact.hopChainProvenanceSignature);
  }
  Object.freeze(artifact.members); Object.freeze(artifact);
  const value = Object.freeze({ artifact, rawFileSha256: actual.toString("hex"), rawFileBase64: bytes.toString("base64") });
  trusted.add(value); return value;
}
