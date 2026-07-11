import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { scanCandidateFiles, scanBuffers, validateCuratedEvidencePaths } from "../tools/secretEvidencePolicy";

const policy = JSON.parse(readFileSync("config/phase4-task0-evidence-allowlist.json", "utf8")) as { schemaVersion: string; planId: string; scope: string; paths: string[] };
if (policy.schemaVersion !== "phase4-task0-evidence-allowlist-v1" || policy.planId !== "phase4-p1-4-secret-evidence-policy" || policy.scope !== "PHASE4_TASK0_ONLY") throw new Error("evidence allowlist binding rejected");
const mode = process.argv[2];
if (mode === "--filesystem") {
  validateCuratedEvidencePaths(policy.paths, policy.paths);
  const result = scanCandidateFiles(process.cwd(), policy.paths, policy.paths);
  process.stdout.write(`${JSON.stringify({ mode, staging: "NOT_EVALUATED", scope: policy.scope, ...result })}\n`);
  if (!result.ok) process.exitCode = 1;
} else if (mode === "--staged") {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "-z", "--", "outputs"]).toString("utf8").split("\0").filter(Boolean).sort();
  validateCuratedEvidencePaths(policy.paths, staged);
  const entries = staged.map((path) => ({ path, bytes: execFileSync("git", ["cat-file", "blob", `:${path}`]) }));
  const result = scanBuffers(entries);
  process.stdout.write(`${JSON.stringify({ mode, staging: "EVALUATED", scope: policy.scope, ...result })}\n`);
  if (!result.ok) process.exitCode = 1;
} else throw new Error("mode must be --filesystem or --staged");
