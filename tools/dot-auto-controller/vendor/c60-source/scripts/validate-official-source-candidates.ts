import { readFile } from "node:fs/promises";
import {
  mergeOfficialSourceResearchCandidateBatches,
  validateOfficialSourceResearchCandidateJson
} from "../src/data/officialSourceResearchCandidate";

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    process.stderr.write("Usage: tsx scripts/validate-official-source-candidates.ts <candidate.json> [...]\n");
    process.exitCode = 2;
    return;
  }

  const batches = [];
  const files = [];
  for (const path of paths) {
    const result = validateOfficialSourceResearchCandidateJson(await readFile(path, "utf8"));
    if (!result.ok) {
      files.push({ path, ok: false, diagnostics: result.diagnostics });
      continue;
    }
    batches.push(result.batch);
    files.push({ path, ok: true, batchId: result.batch.batchId, sha256: result.sha256 });
  }

  if (files.some((file) => !file.ok)) {
    process.stdout.write(`${JSON.stringify({ ok: false, files }, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  if (batches.length === 4) {
    try {
      const merged = mergeOfficialSourceResearchCandidateBatches(batches);
      process.stdout.write(`${JSON.stringify({
        ok: true, files, merged: { batchIds: merged.batchIds, companyCount: merged.companies.length, sha256: merged.sha256 }
      }, null, 2)}\n`);
      return;
    } catch {
      process.stdout.write(`${JSON.stringify({
        ok: false, files,
        diagnostics: [{ code: "CANDIDATE_MERGE_INVALID", message: "Candidate batches failed the exact four-partition merge contract." }]
      }, null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(`${JSON.stringify({ ok: true, files, merge: "SKIPPED_REQUIRES_EXACTLY_FOUR_BATCHES" }, null, 2)}\n`);
}

void main().catch(() => {
  process.stderr.write("Candidate validation failed before safe diagnostics could be produced.\n");
  process.exitCode = 1;
});
