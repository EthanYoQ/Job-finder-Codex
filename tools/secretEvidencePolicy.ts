import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type SecretFinding = Readonly<{ rule: string; path: string; count: number }>;
export type ScanResult = Readonly<{ ok: boolean; findings: readonly SecretFinding[] }>;
export type CandidateEntry = Readonly<{ path: string; sha256: string; bytes: number; role: string }>;
export type CandidateManifest = Readonly<{ schemaVersion: "phase4-code-candidate-v1"; planId: string; baseHead: string; entries: readonly CandidateEntry[] }>;
export const CANDIDATE_PLAN_ID = "docs/superpowers/plans/2026-07-10-p0-recovery-and-release-evidence.md";

const DEFAULT_MAX_BYTES = 1_048_576;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const HARD_DENY = /(?:^|\/)(?:.*(?:\.dump|\.log|\.sql|\.env|\.pem)|(?:stdout|stderr)(?:\.|$)|.*(?:runner|private[-_]?key|large[-_]?diff).*)$/iu;
const RULES = [
  { rule: "private-key-block", pattern: /-----BEGIN (?:ENCRYPTED |RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gu },
  { rule: "authorization-value", pattern: /\bauthorization\s*[:=]\s*["'`][^"'`\r\n]+/giu },
  { rule: "bearer-value", pattern: /\bbearer\s+[a-z0-9._~+/=-]{8,}/giu },
  { rule: "uri-userinfo", pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/giu },
  { rule: "secret-assignment", pattern: /\b(?:password|passwd|pwd|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["'`][^"'`\r\n]+/giu },
  { rule: "jwt", pattern: /\beyJ[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}\b/gu },
  { rule: "provider-key", pattern: /\b(?:sk-(?:live-)?|gh[opusr]_|github_pat_|AKIA|AIza)[a-z0-9_-]{12,}/giu },
  { rule: "high-entropy-assignment", pattern: /\b(?:token|secret|api[_-]?key|access[_-]?key|client[_-]?key)\s*[:=]\s*["'`][a-z0-9+/=_-]{32,}["'`]/giu },
] as const;

export function normalizeRelativePath(input: string): string {
  if(/[\u0000-\u001f\u007f]/u.test(input)) throw new Error("control character path rejected");
  const path = input.replaceAll("\\", "/").replace(/^\.\//u, "");
  const parts = path.split("/");
  if (!path || isAbsolute(input) || parts.some((part) => !part || part === "." || part === "..")) throw new Error("path traversal rejected");
  for (const part of parts) {
    if (part.includes(":")) throw new Error("ADS/device path rejected");
    if (/[. ]$/u.test(part) || RESERVED.test(part)) throw new Error("reserved path rejected");
  }
  return path;
}

export function assertExactPaths(expected: readonly string[], actual: readonly string[]): void {
  const left = expected.map(normalizeRelativePath).sort();
  const right = actual.map(normalizeRelativePath).sort();
  if (new Set(left).size !== left.length || new Set(right).size !== right.length) throw new Error("duplicate path rejected");
  const missing = left.filter((path) => !right.includes(path));
  const unexpected = right.filter((path) => !left.includes(path));
  if (missing.length) throw new Error(`missing paths (count=${missing.length})`);
  if (unexpected.length) throw new Error(`unexpected paths (count=${unexpected.length})`);
}

function decodeUtf8(bytes: Buffer): string {
  if (bytes.includes(0)) throw new Error("binary NUL rejected");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("invalid UTF-8 rejected"); }
}

function isExactHarmless(match: string): boolean {
  const assigned = match.match(/(?:[:=]\s*["'`]|\bbearer\s+)([^"'`\s]+)/iu)?.[1];
  return assigned === "REDACTED" || assigned === "CHANGEME" || assigned === "placeholder" || assigned === "example-placeholder" ||
    /:\/\/[^/@:]+:(?:REDACTED|CHANGEME|placeholder)@/u.test(match);
}

export function scanBuffers(entries: readonly Readonly<{ path: string; bytes: Buffer }>[]): ScanResult {
  const findings: SecretFinding[] = [];
  for (const entry of entries) {
    const path = normalizeRelativePath(entry.path);
    if (entry.bytes.length > DEFAULT_MAX_BYTES) throw new Error(`policy size exceeded: ${path}`);
    const source = decodeUtf8(entry.bytes);
    for (const { rule, pattern } of RULES) {
      let count = 0;
      for (const match of source.matchAll(pattern)) if (!isExactHarmless(match[0])) count += 1;
      if (count) findings.push({ rule, path, count });
    }
  }
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
  return { ok: findings.length === 0, findings };
}

function safeRead(root: string, input: string, maxBytes: number): Buffer {
  const path = normalizeRelativePath(input);
  const canonicalRoot = realpathSync(root);
  let cursor = canonicalRoot;
  for (const component of path.split("/")) {
    cursor = resolve(cursor, component);
    let stat; try { stat = lstatSync(cursor); } catch { throw new Error(`missing candidate path: ${path}`); }
    if (stat.isSymbolicLink()) throw new Error(`symlink or junction rejected: ${path}`);
  }
  const real = realpathSync(cursor);
  if (real !== canonicalRoot && !real.startsWith(`${canonicalRoot}${sep}`)) throw new Error(`realpath containment rejected: ${path}`);
  const before = lstatSync(real);
  if (!before.isFile()) throw new Error(`candidate is not a file: ${path}`);
  if (before.size > maxBytes) throw new Error(`policy size exceeded: ${path}`);
  const bytes = readFileSync(real);
  const after = lstatSync(real);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) throw new Error(`file identity changed during scan: ${path}`);
  decodeUtf8(bytes);
  return bytes;
}

export function scanCandidateFiles(root: string, expected: readonly string[], actual: readonly string[], options: Readonly<{ maxBytes?: number }> = {}): ScanResult {
  assertExactPaths(expected, actual);
  return scanBuffers(actual.map((path) => ({ path, bytes: safeRead(root, path, options.maxBytes ?? DEFAULT_MAX_BYTES) })));
}

export function classifyCandidateRole(path: string): string {
  const value=normalizeRelativePath(path);
  return value.startsWith("tests/") ? "test" : value.startsWith("scripts/") || value.startsWith("tools/") ? "tool" : value.startsWith("prisma/") ? "database-schema" : value.startsWith("docs/") || value.startsWith(".superpowers/") ? "documentation" : value.startsWith("config/") ? "policy" : "runtime";
}

export function validateManifest(manifest: CandidateManifest, paths: readonly string[], blobs: ReadonlyMap<string, Buffer>, expectedHead = manifest.baseHead): void {
  if (manifest.schemaVersion !== "phase4-code-candidate-v1" || manifest.planId !== CANDIDATE_PLAN_ID || manifest.baseHead !== expectedHead || !/^[a-f0-9]{40}$/u.test(manifest.baseHead)) throw new Error("invalid candidate manifest binding");
  assertExactPaths(manifest.entries.map((entry) => entry.path), paths);
  for (const entry of manifest.entries) {
    const bytes = blobs.get(entry.path); if (!bytes) throw new Error("missing candidate blob");
    if (entry.bytes !== bytes.length || entry.sha256 !== createHash("sha256").update(bytes).digest("hex") || entry.role !== classifyCandidateRole(entry.path)) throw new Error(`candidate blob mismatch: ${entry.path}`);
  }
}

export function validateCuratedEvidencePaths(allowlist: readonly string[], actual: readonly string[]): void {
  for (const path of [...allowlist, ...actual].map(normalizeRelativePath)) if (HARD_DENY.test(path)) throw new Error(`denied evidence path: ${path}`);
  assertExactPaths(allowlist, actual);
}

export function validateExternalRawArtifactMetadata(value: Record<string, unknown>): void {
  const required = ["accessPolicy","artifactId","bytes","createdAt","encryption","logicalRole","mediaType","producerCommit","rcId","retentionUntil","retrievalLocatorId","sha256","storageClass"].sort();
  if (Object.keys(value).sort().join(",") !== required.join(",")) throw new Error("external metadata field set rejected");
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.sha256) || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 0) throw new Error("invalid artifact digest metadata");
  for (const key of required.filter((key) => !["sha256","bytes"].includes(key))) {
    const field = value[key]; if (typeof field !== "string" || !field || /(?:[?&](?:token|key|secret)=|:\/\/|^[a-z]:[\\/]|^\\\\)/iu.test(field)) throw new Error(`unsafe metadata field: ${key}`);
  }
  const created=Date.parse(String(value.createdAt)), retention=Date.parse(String(value.retentionUntil));
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(String(value.producerCommit)) || !/^p0-rc-[0-9]{8}-[0-9]{3}$/u.test(String(value.rcId)) || Number.isNaN(created) || Number.isNaN(retention) || retention<=created) throw new Error("invalid metadata binding");
  if(value.storageClass!=="ACCESS_CONTROLLED_ARTIFACT_STORE"||value.accessPolicy!=="RESTRICTED_RELEASE_EVIDENCE"||value.encryption!=="AT_REST_AND_IN_TRANSIT") throw new Error("invalid metadata enum");
  if(!["application-json","text-plain","text-markdown"].includes(String(value.mediaType)) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(String(value.retrievalLocatorId))) throw new Error("invalid metadata locator or media type");
}
