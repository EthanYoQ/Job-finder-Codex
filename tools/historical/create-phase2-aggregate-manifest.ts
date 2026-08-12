import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { candidateCompanies, companyRosterSha256, CONFIRMED_ROSTER_V3_PROVENANCE,
  CONFIRMED_V3_TO_RUNTIME_COMPANY_ID } from "../../src/data/companyRegistry";
import { canonicalCandidateHash, mergeOfficialSourceResearchCandidateBatches,
  parseOfficialSourceResearchCandidateBatch } from "../../src/data/officialSourceResearchCandidate";
import { parseCurrentBindingCompanion, phase2ManifestContentHash, validatePhase2AggregateManifest, type Phase2AggregateManifest }
  from "../../src/evidence/phase2AggregateManifest";

if (!process.argv.includes("--nonproduction-historical-recovery")) throw new Error("explicit nonproduction historical wrapper flag required");

const RC = "outputs/p0-rc/p0-rc-20260710-001";
const batchPaths = [
  "phase-2/task-2-canonical/F01-foreign-01-15.canonical.json", "phase-2/task-2-canonical/F02-foreign-16-30.canonical.json",
  "phase-2/task-2-canonical/D01-domestic-01-15.canonical.json", "phase-2/task-2-canonical/D02-domestic-16-30.canonical.json"
];
const qa = [
  ["F01_FINAL", "F01", "phase-2/task-2-independent-qa/F01-current-binding-companion.json", "phase-2/task-2-independent-qa/F01-final-bounded-pass.md"],
  ["F02_FINAL", "F02", "phase-2/task-2-independent-qa/F02-current-binding-companion.json", "phase-2/task-2-independent-qa/F02-independent-official-chain-rereview.md"],
  ["D01_FINAL", "D01", "phase-2/task-2-independent-qa/D01-current-binding-companion.json", "phase-2/task-2-independent-qa/D01-independent-official-chain-final-qa.md"],
  ["D02_FINAL", "D02", "phase-2/task-2-independent-qa/D02-current-binding-companion.json", "phase-2/task-2-independent-qa/D02-independent-final-bounded-pass.md"],
  ["TASK1_FINAL", undefined, "phase-2/task-1-command-presync-independent-final-qa.md", "2026-07-11T19:00:00+08:00"],
  ["CONTRACT_FINAL", undefined, "phase-2/task-2-canonical-candidate-contract-independent-final-rereview.md", "2026-07-11T19:00:00+08:00"],
  ["CSPC_FINAL", undefined, "phase-2/task-2-cspc-redsea-taxonomy-independent-rereview.md", "2026-07-11T19:00:00+08:00"]
] as const;

async function fileFact(path: string) {
  const bytes = await readFile(resolve(path));
  return { bytes: bytes.byteLength, physicalSha256: createHash("sha256").update(bytes).digest("hex") };
}

async function main(): Promise<void> {
  const output = process.argv[2];
  if (!output) throw new Error("output path required");
  const parsed = await Promise.all(batchPaths.map(async (path) => {
    const absolute = resolve(RC, path); const physical = await fileFact(absolute);
    const batch = parseOfficialSourceResearchCandidateBatch(JSON.parse(await readFile(absolute, "utf8")));
    return { path, batch, ...physical };
  }));
  const merged = mergeOfficialSourceResearchCandidateBatches(parsed.map((item) => item.batch));
  const reports = await Promise.all(qa.map(async ([id, batchId, path, fourth]) => {
    if (!batchId) return { id, path, ...(await fileFact(resolve(RC,path))), decision:"FINAL_BOUNDED_PASS" as const, capturedAt:fourth };
    const text=await readFile(resolve(RC,path),"utf8"); const content=JSON.parse(text); const binding=parseCurrentBindingCompanion(content,batchId);
    const originalPath=fourth; return { id,batchId,path,...(await fileFact(resolve(RC,path))),decision:"FINAL_BOUNDED_PASS" as const,
      capturedAt:binding.capturedAt, companionRaw:text, originalReport:{path:originalPath,...(await fileFact(resolve(RC,originalPath)))} };
  }));
  const dirty = execFileSync("git", ["status", "--porcelain=v2"], { encoding: "utf8" });
  const source = await fileFact("src/data/officialSourceResearchCandidate.ts");
  const test = await fileFact("tests/data/officialSourceResearchCandidate.test.ts");
  const aggregateValidator = await fileFact("src/evidence/phase2AggregateManifest.ts");
  const aggregateTest = await fileFact("tests/evidence/phase2AggregateManifest.test.ts");
  const mappingSha256 = createHash("sha256").update(JSON.stringify(CONFIRMED_V3_TO_RUNTIME_COMPANY_ID)).digest("hex");
  const content: Omit<Phase2AggregateManifest, "integrity"> = {
    schemaVersion: "phase2-aggregate-freeze-v1", rcId: "p0-rc-20260710-001",
    goalId: "019f4b10-36e1-75e0-8586-1e4beec344ee", capturedAt: new Date().toISOString(),
    git: { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), commitBound: false,
      dirtyStatusSha256: createHash("sha256").update(dirty).digest("hex"), dirtyEntryCount: dirty.trim().split(/\r?\n/u).filter(Boolean).length,
      boundary: "Captured before aggregate/root pointer writes; dirty worktree is hash-bound, not commit-bound." },
    roster: { foreign: 30, domestic: 30, total: 60, rosterSha256: companyRosterSha256(candidateCompanies), mappingSha256,
      provenance: CONFIRMED_ROSTER_V3_PROVENANCE },
    contract: { sourceSha256: source.physicalSha256, testSha256: test.physicalSha256,
      aggregateValidatorSha256: aggregateValidator.physicalSha256, aggregateTestSha256: aggregateTest.physicalSha256 },
    batches: parsed.map(({ path, batch, bytes, physicalSha256 }) => ({ batchId: batch.batchId, path, bytes, physicalSha256,
      semanticSha256: canonicalCandidateHash(batch), captureStartedAt: batch.captureStartedAt,
      captureCompletedAt: batch.captureCompletedAt, companyCount: 15 as const,
      surfaceCount: batch.companies.flatMap((company) => company.surfaces).length,
      channelCount: batch.companies.flatMap((company) => company.surfaces.flatMap((surface) => surface.channels)).length,
      surfaceStatuses: Object.fromEntries(["PENDING", "BLOCKED", "EXCLUDED"].map((status) => [status,
        batch.companies.flatMap((company) => company.surfaces).filter((surface) => surface.candidateStatus === status).length])) as Record<"PENDING" | "BLOCKED" | "EXCLUDED", number>,
      channelStatuses: Object.fromEntries(["PENDING", "UNRESOLVED"].map((status) => [status,
        batch.companies.flatMap((company) => company.surfaces.flatMap((surface) => surface.channels)).filter((channel) => channel.discoveryStatus === status).length])) as Record<"PENDING" | "UNRESOLVED", number>,
      promotionCount: 0 as const, activeCount: 0 as const })),
    merged: { companyCount: 60, semanticSha256: merged.sha256 }, qaReports: reports,
    boundaries: { tavily: "DISCOVERY_ONLY_NOT_OFFICIAL_CHAIN_OR_PRODUCTION_EVIDENCE", database: "NOT_ACCESSED",
      crawl: "NOT_RUN", promotion: "ZERO", releaseClaim: false }
  };
  const manifest: Phase2AggregateManifest = { ...content, integrity: { contentSha256: phase2ManifestContentHash(content) } };
  const errors = validatePhase2AggregateManifest(manifest, new Date()); if (errors.length) throw new Error(errors.join(","));
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(output, serialized, { flag: "wx" });
  const physicalSha256 = createHash("sha256").update(serialized).digest("hex");
  await writeFile(`${output}.sha256.json`, `${JSON.stringify({ path: relative(resolve(RC), resolve(output)).replaceAll("\\", "/"),
    bytes: Buffer.byteLength(serialized), sha256: physicalSha256 }, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output, bytes: Buffer.byteLength(serialized), sha256: physicalSha256,
    contentSha256: manifest.integrity.contentSha256, mergedSha256: merged.sha256 }, null, 2)}\n`);
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "aggregate failed"}\n`); process.exitCode = 1; });
