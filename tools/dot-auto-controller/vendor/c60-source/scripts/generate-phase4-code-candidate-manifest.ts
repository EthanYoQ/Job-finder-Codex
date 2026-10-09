import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CANDIDATE_PLAN_ID, classifyCandidateRole, normalizeRelativePath } from "../tools/secretEvidencePolicy";

const manifestPath = "config/phase4-code-candidate-manifest.json";
const gitPaths = (args: string[]) => execFileSync("git", [...args,"-z"]).toString("utf8").split("\0").filter(Boolean);
const paths = [...gitPaths(["diff", "--name-only"]), ...gitPaths(["ls-files", "--others", "--exclude-standard"])]
  .map(normalizeRelativePath)
  .filter((path) => !path.startsWith("outputs/") && !path.startsWith(".superpowers/sdd/") && path !== manifestPath)
  .filter((path, index, values) => values.indexOf(path) === index).sort();
const entries = paths.map((path) => { const bytes = readFileSync(resolve(path)); return { path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, role: classifyCandidateRole(path) }; });
const manifest = { schemaVersion: "phase4-code-candidate-v1", planId: CANDIDATE_PLAN_ID, baseHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), entries };
mkdirSync("config",{recursive:true});
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
process.stdout.write(`${JSON.stringify({ ok: true, path: manifestPath, entries: entries.length })}\n`);
