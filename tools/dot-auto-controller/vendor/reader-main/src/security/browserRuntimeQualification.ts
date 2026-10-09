import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  compareDottedVersions,
  PRODUCTION_BROWSER_DEB_NAME,
  PRODUCTION_BROWSER_DEB_SHA256,
  PRODUCTION_BROWSER_DEB_URL,
  PRODUCTION_BROWSER_ENGINE_REALPATH,
  PRODUCTION_BROWSER_KEYRING_DEB_SHA256,
  PRODUCTION_BROWSER_MIN_ENGINE_VERSION,
  PRODUCTION_BROWSER_RELEASE
} from "../readiness/productionImageContract";

const FORMAL_BROWSER_PATH = "/usr/bin/chromium";

export interface BrowserRuntimeQualificationReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  imageDigest: string;
  browserRelease: typeof PRODUCTION_BROWSER_RELEASE;
  latestStableRelease: typeof PRODUCTION_BROWSER_RELEASE;
  assetSha256: typeof PRODUCTION_BROWSER_DEB_SHA256;
  keyringAssetSha256: typeof PRODUCTION_BROWSER_KEYRING_DEB_SHA256;
  engineVersion: string;
  engineExecutableRealpath: typeof PRODUCTION_BROWSER_ENGINE_REALPATH;
  minimumEngineVersion: typeof PRODUCTION_BROWSER_MIN_ENGINE_VERSION;
  rawRuntimeSha256: string;
  githubReleaseSha256: string;
  evaluatedAt: string;
  contentSha256: string;
}

export function createBrowserRuntimeQualificationReceipt(
  rawRuntimeBytes: Buffer,
  githubReleaseBytes: Buffer,
  imageDigest: string,
  evaluatedAt = new Date()
): BrowserRuntimeQualificationReceipt {
  const raw = parseJson(rawRuntimeBytes, "Browser runtime probe");
  if (!isRecord(raw) || !exactKeys(raw, ["status", "executablePath", "engineExecutableRealpath", "engineVersion"]) ||
      raw.status !== "PASS" || raw.executablePath !== FORMAL_BROWSER_PATH ||
      raw.engineExecutableRealpath !== PRODUCTION_BROWSER_ENGINE_REALPATH ||
      !isEngineVersion(raw.engineVersion) ||
      compareDottedVersions(raw.engineVersion, PRODUCTION_BROWSER_MIN_ENGINE_VERSION) < 0) {
    throw new Error("Browser runtime probe is invalid");
  }
  validateGithubRelease(parseJson(githubReleaseBytes, "GitHub browser release"));
  if (!isImageDigest(imageDigest) || !Number.isFinite(evaluatedAt.getTime())) {
    throw new Error("Browser runtime qualification identity is invalid");
  }
  const base = {
    schemaVersion: 1 as const,
    decision: "PASSED" as const,
    imageDigest,
    browserRelease: PRODUCTION_BROWSER_RELEASE,
    latestStableRelease: PRODUCTION_BROWSER_RELEASE,
    assetSha256: PRODUCTION_BROWSER_DEB_SHA256,
    keyringAssetSha256: PRODUCTION_BROWSER_KEYRING_DEB_SHA256,
    engineVersion: raw.engineVersion,
    engineExecutableRealpath: PRODUCTION_BROWSER_ENGINE_REALPATH,
    minimumEngineVersion: PRODUCTION_BROWSER_MIN_ENGINE_VERSION,
    rawRuntimeSha256: sha256(rawRuntimeBytes),
    githubReleaseSha256: sha256(githubReleaseBytes),
    evaluatedAt: evaluatedAt.toISOString()
  };
  return { ...base, contentSha256: sha256(Buffer.from(JSON.stringify(base), "utf8")) };
}

export function parseBrowserRuntimeQualificationReceipt(
  bytes: Buffer,
  expectedImageDigest?: string
): BrowserRuntimeQualificationReceipt {
  const value = parseJson(bytes, "Browser runtime qualification receipt");
  const keys = ["schemaVersion", "decision", "imageDigest", "browserRelease", "latestStableRelease",
    "assetSha256", "keyringAssetSha256", "engineVersion", "engineExecutableRealpath", "minimumEngineVersion", "rawRuntimeSha256", "githubReleaseSha256",
    "evaluatedAt", "contentSha256"];
  if (!isRecord(value) || !exactKeys(value, keys) || value.schemaVersion !== 1 || value.decision !== "PASSED" ||
      !isImageDigest(value.imageDigest) || (expectedImageDigest !== undefined && value.imageDigest !== expectedImageDigest) ||
      value.browserRelease !== PRODUCTION_BROWSER_RELEASE || value.latestStableRelease !== PRODUCTION_BROWSER_RELEASE ||
      value.assetSha256 !== PRODUCTION_BROWSER_DEB_SHA256 || !isEngineVersion(value.engineVersion) ||
      value.engineExecutableRealpath !== PRODUCTION_BROWSER_ENGINE_REALPATH ||
      value.keyringAssetSha256 !== PRODUCTION_BROWSER_KEYRING_DEB_SHA256 ||
      compareDottedVersions(value.engineVersion, PRODUCTION_BROWSER_MIN_ENGINE_VERSION) < 0 ||
      value.minimumEngineVersion !== PRODUCTION_BROWSER_MIN_ENGINE_VERSION ||
      !isSha256(value.rawRuntimeSha256) || !isSha256(value.githubReleaseSha256) ||
      !isCanonicalIsoDate(value.evaluatedAt) || !isSha256(value.contentSha256)) {
    throw new Error("Browser runtime qualification receipt schema is invalid");
  }
  const { contentSha256, ...base } = value;
  if (sha256(Buffer.from(JSON.stringify(base), "utf8")) !== contentSha256) {
    throw new Error("Browser runtime qualification receipt content hash mismatch");
  }
  return value as unknown as BrowserRuntimeQualificationReceipt;
}

export async function readBrowserRuntimeQualificationReceipt(
  path: string,
  expectedImageDigest?: string
): Promise<BrowserRuntimeQualificationReceipt> {
  return parseBrowserRuntimeQualificationReceipt(await readFile(path), expectedImageDigest);
}

function validateGithubRelease(value: unknown): void {
  if (!isRecord(value) || value.tag_name !== PRODUCTION_BROWSER_RELEASE || value.draft !== false ||
      value.prerelease !== false || !Array.isArray(value.assets)) {
    throw new Error("GitHub browser release is not the pinned stable release");
  }
  const namedAssets = value.assets.filter((asset) => isRecord(asset) && asset.name === PRODUCTION_BROWSER_DEB_NAME);
  if (namedAssets.length !== 1 || !isRecord(namedAssets[0]) ||
      namedAssets[0].browser_download_url !== PRODUCTION_BROWSER_DEB_URL ||
      namedAssets[0].digest !== `sha256:${PRODUCTION_BROWSER_DEB_SHA256}`) {
    throw new Error("GitHub browser release asset identity is invalid");
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try { return JSON.parse(bytes.toString("utf8")) as unknown; }
  catch { throw new Error(`${label} is not valid JSON`); }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isImageDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isEngineVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+\.\d+$/u.test(value);
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
