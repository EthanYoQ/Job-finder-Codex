import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { scanBuffers, validateManifest, type CandidateManifest } from "../tools/secretEvidencePolicy";

const manifestPath = "config/phase4-code-candidate-manifest.json";
const mode = process.argv[2];
if (mode !== "--prestage" && mode !== "--staged") throw new Error("mode must be --prestage or --staged");
const pathsFromGit = (args: string[]) => execFileSync("git", [...args,"-z"]).toString("utf8").split("\0").filter(Boolean);
const excluded = (path: string) => path.startsWith("outputs/") || path.startsWith(".superpowers/sdd/") || path === manifestPath;
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const manifestBytes = mode === "--staged" ? execFileSync("git", ["cat-file", "blob", `:${manifestPath}`]) : readFileSync(manifestPath);
const manifest = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifestBytes)) as CandidateManifest;
if (manifest.baseHead !== head) throw new Error("candidate manifest baseHead mismatch");
const paths = mode === "--staged"
  ? pathsFromGit(["diff", "--cached", "--name-only"]).filter((path) => !excluded(path)).sort()
  : [...pathsFromGit(["diff", "--name-only"]), ...pathsFromGit(["ls-files", "--others", "--exclude-standard"])].filter((path) => !excluded(path)).filter((path, index, values) => values.indexOf(path) === index).sort();
if (mode === "--staged") {
  const stagedAll=pathsFromGit(["diff","--cached","--name-only"]).sort();
  const unstaged = new Set(pathsFromGit(["diff", "--name-only"]));
  const expected=[...manifest.entries.map(e=>e.path),manifestPath].sort();
  if(JSON.stringify(stagedAll)!==JSON.stringify(expected)) throw new Error("staged set does not equal manifest entries plus manifest");
  if (expected.some((path) => unstaged.has(path))) throw new Error("staged candidate or manifest also has unstaged changes");
}
const candidatePaths=mode==="--staged"?paths.filter(p=>p!==manifestPath):paths;
const entries = candidatePaths.map((path) => ({ path, bytes: mode === "--staged" ? execFileSync("git", ["cat-file","blob", `:${path}`]) : readFileSync(path) }));
validateManifest(manifest, candidatePaths, new Map(entries.map((entry) => [entry.path, entry.bytes])),head);
const result = scanBuffers(entries);
process.stdout.write(`${JSON.stringify({ mode, ...result })}\n`);
if (!result.ok) process.exitCode = 1;
