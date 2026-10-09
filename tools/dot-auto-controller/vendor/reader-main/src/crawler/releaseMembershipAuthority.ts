import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AuthoritativeReleaseMembershipArtifact } from "./authoritativeReleaseMembership";

export interface StartupTrustedReleaseMembership {
  readonly artifact: AuthoritativeReleaseMembershipArtifact;
  readonly rawFileSha256: string;
  readonly rawFileBase64: string;
}

const startupPath = process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE;
const startupSha256 = process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256;
delete process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE;
delete process.env.P0_FULL_RELEASE_MEMBERSHIP_FILE_SHA256;

const startupSnapshot = Object.freeze({ path: startupPath, sha256: startupSha256 });
const trusted = new WeakSet<object>();
let loaded: Promise<StartupTrustedReleaseMembership> | undefined;

export function getStartupReleaseMembership(): Promise<StartupTrustedReleaseMembership> {
  loaded ??= loadStartupSnapshot();
  return loaded;
}

export function assertStartupTrustedReleaseMembership(
  value: StartupTrustedReleaseMembership | undefined
): asserts value is StartupTrustedReleaseMembership {
  if (!value || !trusted.has(value)) throw new Error("Membership is not trusted by startup authority");
}

async function loadStartupSnapshot(): Promise<StartupTrustedReleaseMembership> {
  if (!startupSnapshot.path || !startupSnapshot.sha256 || !/^[a-f0-9]{64}$/.test(startupSnapshot.sha256)) {
    throw new Error("FULL_RELEASE startup membership authority is unavailable");
  }
  const bytes = await readFile(startupSnapshot.path);
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(startupSnapshot.sha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Startup membership artifact file digest mismatch");
  }
  const artifact = JSON.parse(bytes.toString("utf8")) as AuthoritativeReleaseMembershipArtifact;
  if (artifact.oracleAuthority) Object.freeze(artifact.oracleAuthority);
  artifact.members.forEach(Object.freeze);
  Object.freeze(artifact.members);
  Object.freeze(artifact);
  const value = Object.freeze({ artifact, rawFileSha256: actual.toString("hex"), rawFileBase64: bytes.toString("base64") });
  trusted.add(value);
  return value;
}
