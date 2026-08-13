import { createHash } from "node:crypto";
import executableContractJson from "./runtimeExposureContract.json";

export interface RuntimeExposureReceipt {
  schemaVersion: 1;
  decision: "PASSED";
  imageDigest: string;
  trivySha256: string;
  rawProbeSha256: string;
  evaluatedAt: string;
  facts: RuntimeExposureFacts;
  contentSha256: string;
}

export interface RuntimeExposureFacts {
  platform: "linux";
  architecture: "x64";
  uid: number;
  effectiveCapabilities: string;
  noNewPrivileges: string;
  rootMountOptions: string[];
  tmpMountOptions: string[];
  dbusEnvironment: string[];
  dbusSockets: string[];
  blockDevices: string[];
  forbiddenSpawnReferences: string[];
  minizipLibraries: string[];
  executablePaths: Record<string, string | null>;
  elfClasses: Record<string, number>;
  dynamicLibraries: Record<string, string[]>;
  capturedAt: string;
}

export function createRuntimeExposureReceipt(rawBytes: Buffer, trivyBytes: Buffer, imageDigest: string,
  evaluatedAt = new Date()): RuntimeExposureReceipt {
  const raw = JSON.parse(rawBytes.toString("utf8")) as unknown;
  const trivy = JSON.parse(trivyBytes.toString("utf8")) as unknown;
  if (!isRecord(raw) || !exactKeys(raw, ["schemaVersion", "status", ...FACT_KEYS]) ||
    raw.schemaVersion !== 1 || raw.status !== "PASS") {
    throw new Error("Runtime exposure probe schema is invalid");
  }
  const facts = parseFacts(Object.fromEntries(FACT_KEYS.map((key) => [key, raw[key]])));
  if (!isDigest(imageDigest) || !isRecord(trivy) || !isRecord(trivy.Metadata) ||
    trivy.Metadata.ImageID !== imageDigest || !Number.isFinite(evaluatedAt.getTime())) {
    throw new Error("Runtime exposure identity is invalid");
  }
  validateSafeFacts(facts, evaluatedAt);
  const base = { schemaVersion: 1 as const, decision: "PASSED" as const, imageDigest,
    trivySha256: sha(trivyBytes), rawProbeSha256: sha(rawBytes), evaluatedAt: evaluatedAt.toISOString(), facts };
  return { ...base, contentSha256: sha(Buffer.from(JSON.stringify(base))) };
}

export function parseRuntimeExposureReceipt(bytes: Buffer, imageDigest: string, trivySha256: string,
  now = new Date()): RuntimeExposureReceipt {
  if (!Number.isFinite(now.getTime())) throw new Error("Runtime exposure receipt evaluation time is invalid");
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "decision", "imageDigest", "trivySha256",
    "rawProbeSha256", "evaluatedAt", "facts", "contentSha256"]) || value.schemaVersion !== 1 || value.decision !== "PASSED" ||
    value.imageDigest !== imageDigest || value.trivySha256 !== trivySha256 || !isSha(value.rawProbeSha256) ||
    typeof value.evaluatedAt !== "string" || new Date(value.evaluatedAt).toISOString() !== value.evaluatedAt ||
    !isRecord(value.facts) || !isSha(value.contentSha256)) throw new Error("Runtime exposure receipt is invalid");
  const facts = parseFacts(value.facts);
  validateSafeFacts(facts, now);
  const { contentSha256, ...base } = value;
  if (sha(Buffer.from(JSON.stringify(base))) !== contentSha256) throw new Error("Runtime exposure receipt hash mismatch");
  return value as unknown as RuntimeExposureReceipt;
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const isRecord = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
const isDigest = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const isSha = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isNullableStringRecord = (value: unknown): value is Record<string, string | null> => isRecord(value) && Object.values(value).every((item) => item === null || typeof item === "string");
const isNumberRecord = (value: unknown): value is Record<string, number> => isRecord(value) && Object.values(value).every((item) => Number.isInteger(item));
const isStringArrayRecord = (value: unknown): value is Record<string, string[]> => isRecord(value) && Object.values(value).every(isStringArray);
const executableContract = parseExecutableContract();
export const RUNTIME_EXPOSURE_RISKY_EXECUTABLES = executableContract.riskyExecutables;
export const RUNTIME_EXPOSURE_FORMAL_EXECUTABLES = executableContract.formalExecutables;
const FACT_KEYS = ["platform", "architecture", "uid", "effectiveCapabilities", "noNewPrivileges", "rootMountOptions",
  "tmpMountOptions", "dbusEnvironment", "dbusSockets",
  "blockDevices", "forbiddenSpawnReferences", "minizipLibraries", "executablePaths", "elfClasses", "dynamicLibraries",
  "capturedAt"] as const;
function parseFacts(value: Record<string, any>): RuntimeExposureFacts {
  if (!exactKeys(value, FACT_KEYS) || value.platform !== "linux" || value.architecture !== "x64" ||
    !Number.isInteger(value.uid) || Number(value.uid) <= 0 || typeof value.effectiveCapabilities !== "string" ||
    typeof value.noNewPrivileges !== "string" || !isStringArray(value.rootMountOptions) || !isStringArray(value.tmpMountOptions) ||
    !isStringArray(value.dbusEnvironment) || !isStringArray(value.dbusSockets) || !isStringArray(value.blockDevices) ||
    !isStringArray(value.forbiddenSpawnReferences) || !isStringArray(value.minizipLibraries) ||
    !isNullableStringRecord(value.executablePaths) || !isNumberRecord(value.elfClasses) ||
    !isStringArrayRecord(value.dynamicLibraries) || typeof value.capturedAt !== "string" ||
    !isCanonicalInstant(value.capturedAt)) throw new Error("Runtime exposure facts are invalid");
  return value as RuntimeExposureFacts;
}
function validateSafeFacts(facts: RuntimeExposureFacts, evaluatedAt: Date): void {
  const capturedAt = new Date(facts.capturedAt).getTime();
  if (facts.effectiveCapabilities !== "0000000000000000" || facts.noNewPrivileges !== "1" ||
    !facts.rootMountOptions.includes("ro") || !["rw", "nosuid", "nodev", "noexec"].every((option) => facts.tmpMountOptions.includes(option)) ||
    !exactKeys(facts.executablePaths, RUNTIME_EXPOSURE_RISKY_EXECUTABLES) ||
    !exactKeys(facts.elfClasses, RUNTIME_EXPOSURE_FORMAL_EXECUTABLES) ||
    !exactKeys(facts.dynamicLibraries, RUNTIME_EXPOSURE_FORMAL_EXECUTABLES) || facts.dbusEnvironment.length > 0 ||
    facts.dbusSockets.length > 0 || facts.blockDevices.length > 0 || facts.forbiddenSpawnReferences.length > 0 ||
    facts.minizipLibraries.length > 0 || Object.values(facts.elfClasses).some((value) => value !== 2) ||
    Object.values(facts.dynamicLibraries).some((entries) => entries.length === 0 || entries.some((entry) => /not found|undefined symbol|LDD_FAILED/iu.test(entry))) ||
    capturedAt > evaluatedAt.getTime() + 60_000 || evaluatedAt.getTime() - capturedAt > 5 * 60_000) {
    throw new Error("Runtime exposure facts do not satisfy the fail-closed production policy");
  }
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function isCanonicalInstant(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function parseExecutableContract(): { formalExecutables: readonly string[]; riskyExecutables: readonly string[] } {
  const value: unknown = executableContractJson;
  if (!isRecord(value) || !exactKeys(value, ["formalExecutables", "riskyExecutables"]) ||
      !isStringArray(value.formalExecutables) || !isStringArray(value.riskyExecutables) ||
      value.formalExecutables.length !== new Set(value.formalExecutables).size ||
      value.riskyExecutables.length !== new Set(value.riskyExecutables).size) {
    throw new Error("Runtime exposure executable contract is invalid");
  }
  return { formalExecutables: Object.freeze([...value.formalExecutables]),
    riskyExecutables: Object.freeze([...value.riskyExecutables]) };
}
