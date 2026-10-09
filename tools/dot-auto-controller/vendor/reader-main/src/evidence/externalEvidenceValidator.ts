import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const EXTERNAL_EVIDENCE_MANIFEST_SCHEMA = "job-finder-external-evidence-v1";
export const EXTERNAL_EVIDENCE_EXPECTED_PATHS = Object.freeze([
  "outputs/p0-rc/p0-rc-20260710-001/manifest.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-1/task-3-migration-validation-procedure.md",
  "outputs/p0-rc/p0-rc-20260710-001/phase-2/phase-2-aggregate-freeze-manifest.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-2/phase-2-holistic-independent-final-pass.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/phase-3-aggregate-freeze-manifest.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-1-pure-lifecycle-reducer-independent-qa.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-2-runtime-atomic-lifecycle-binding-independent-qa.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3a-lifecycle-set-reconciliation-independent-qa.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-lifecycle-member-persistence-independent-final-qa.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/manifest.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/manifest-self-check.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/00-dump-sha.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/01-source-before.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/02-copy-counts-sql.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/03-source-before-all-counts.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/04-clone-preexist.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/05-copy-dump.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/06-create-clone.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/07-restore-clone.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/08-resolve-baseline.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/09-deploy-ten.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/10-migration-status.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/11-pgcrypto-version.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/12-extension-security-catalog.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/13-copy-smoke.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/14-constraint-smoke.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/15-wrong-valid64-sha-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/16-parent-set-mismatch-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/17-negative-rollback-count.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/18-parent-gate-setup.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/19-zero-members-nonempty-parent-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/20-zero-members-exact-empty-parent-accepted.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/21-partial-member-set-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/22-nonverified-zero-member-not-gated.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/23-nonverified-valid-pair-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/24-fixture-parent-pending.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/25-pending-valid-pair-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/26-reenable-fixture-trigger.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/27-triggers-before-unicode.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/28-copy-unicode-smoke.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/29-unicode-smoke.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/30-shadow-search-path-attack.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/31-function-security-catalog.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/32-triggers-before-repository.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/33-repository-runtime.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/34-triggers-before-tamper.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/35-committed-parent-update-rejected.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/36-triggers-before-final-counts.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/37-clone-all-counts.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/38-clone-final.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/39-source-after.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/40-source-after-all-counts.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/41-drop-clone.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/42-clone-inventory.json",
  "outputs/p0-rc/p0-rc-20260710-001/phase-3/task-3b-security-gate-evidence-20260711t2415/43-cleanup-temp.json",
] as const);
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/u;

interface FileBinding { path: string; bytes: number; sha256: string }
interface ExternalManifest { schemaVersion: string; files: FileBinding[] }

export interface ExternalEvidenceSnapshot { readonly root: string; readonly files: ReadonlyMap<string, Buffer>; text(path:string):string }
export function validateExternalEvidenceRoot(options: {
  root?: string; manifestPath?: string; manifestSha256?: string; expectedPaths?: readonly string[];
} = {}): ExternalEvidenceSnapshot {
  const root = options.root ?? process.env.EVIDENCE_ROOT;
  const manifestPath = options.manifestPath ?? process.env.EVIDENCE_HASH_MANIFEST;
  const pinnedSha = options.manifestSha256 ?? process.env.EVIDENCE_HASH_MANIFEST_SHA256;
  if (!root || !manifestPath || !pinnedSha) throw new Error("external evidence requires root, manifest, and pinned manifest sha256");
  assertSha(pinnedSha, "manifest pin");
  if(lstatSync(root).isSymbolicLink())throw new Error("external evidence root symlink or junction rejected");
  const rootReal = realpathSync(root);
  const manifestReal = containedRealFile(rootReal, manifestPath);
  const manifestBytes = boundedRead(manifestReal);
  equalSha(sha(manifestBytes), pinnedSha, "manifest pin mismatch");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as ExternalManifest;
  if (manifest.schemaVersion !== EXTERNAL_EVIDENCE_MANIFEST_SCHEMA || !Array.isArray(manifest.files)) throw new Error("external evidence manifest schema invalid");
  const expected = [...(options.expectedPaths ?? EXTERNAL_EVIDENCE_EXPECTED_PATHS)].sort();
  const actual = manifest.files.map((item) => normalizeRelative(item.path)).sort();
  if (new Set(actual).size !== actual.length) throw new Error("duplicate external evidence path");
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("external evidence path set mismatch");
  const snapshots=new Map<string,Buffer>();
  for (const item of manifest.files) {
    const path = normalizeRelative(item.path);
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_FILE_BYTES) throw new Error(`external evidence bytes invalid: ${path}`);
    assertSha(item.sha256, `external evidence digest: ${path}`);
    const fileReal = containedRealFile(rootReal, resolve(rootReal, path));
    const bytes = boundedRead(fileReal);
    if (bytes.length !== item.bytes) throw new Error(`external evidence byte mismatch: ${path}`);
    equalSha(sha(bytes), item.sha256, `external evidence digest mismatch: ${path}`);
    snapshots.set(path,Buffer.from(bytes));
  }
  return Object.freeze({root:rootReal,files:snapshots,text(path:string){const bytes=snapshots.get(path);if(!bytes)throw new Error(`external evidence path is not in validated snapshot: ${path}`);return Buffer.from(bytes).toString("utf8")}});
}

function containedRealFile(rootReal: string, candidate: string): string {
  if (candidate.includes("\0")) throw new Error("NUL in external evidence path");
  const absolute = isAbsolute(candidate) ? candidate : resolve(rootReal, candidate);
  rejectLinkedComponents(rootReal, absolute);
  const real = realpathSync(absolute);
  const rel = relative(rootReal, real);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("external evidence path escapes fixed root");
  if (!statSync(real).isFile()) throw new Error("external evidence path is not a file");
  return real;
}
function rejectLinkedComponents(rootReal:string,absolute:string):void{const rel=relative(rootReal,absolute);if(rel===".."||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw new Error("external evidence path escapes fixed root");const components=rel.split(sep).filter(Boolean);let current=rootReal;if(lstatSync(current).isSymbolicLink())throw new Error("external evidence root symlink rejected");for(const component of components){current=resolve(current,component);if(lstatSync(current).isSymbolicLink())throw new Error("external evidence symlink or junction component rejected")}}
function boundedRead(path: string): Buffer { const size=statSync(path).size;if(size<1||size>MAX_FILE_BYTES)throw new Error("external evidence file size rejected");return readFileSync(path); }
function normalizeRelative(value: string): string { if(typeof value!=="string"||value.includes("\0")||isAbsolute(value)||value.includes("\\"))throw new Error("invalid external evidence relative path");const normalized=value.split("/");if(normalized.some(x=>!x||x==="."||x===".."))throw new Error("invalid external evidence relative path");return normalized.join("/"); }
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function assertSha(value:string,label:string):void{if(!SHA.test(value))throw new Error(`${label} invalid`)}
function equalSha(actual:string,expected:string,message:string):void{assertSha(actual,"actual sha");assertSha(expected,"expected sha");if(!timingSafeEqual(Buffer.from(actual,"hex"),Buffer.from(expected,"hex")))throw new Error(message)}
