/** Offline synthetic export. Never contact Lilly, write a DB, or relabel these files as a live acquisition. */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { captureSyntheticLillyQuality, buildSyntheticLillyAtomicFixture } from "../tests/helpers/lillyQualityFixture";
import { LILLY_SYNTHETIC_FIXTURE_KIND } from "../tests/helpers/lillyPhenom";
import { verifyAtomicRuntimeCommitForPersistence } from "../src/crawler/runtimeAtomicEvidence";
import { verifySourceQualityAtomicCommit } from "../src/crawler/sourceQualityAdmission";

const output = process.argv[2];
if (!output) throw Error("Usage: node --import tsx scripts/verify-lilly-synthetic.ts <synthetic-output-directory>");
const workspaceRoot = resolve(output);
await mkdir(workspaceRoot, {recursive: true});
const input = await captureSyntheticLillyQuality(workspaceRoot);
const fixture = await buildSyntheticLillyAtomicFixture(input);
verifySourceQualityAtomicCommit({plan: input.plan, commit: fixture.commit});
await verifyAtomicRuntimeCommitForPersistence(fixture.commit);
const files = {
  "synthetic-response-pages.json": JSON.stringify(input.result.fetchEvidence!.artifacts.filter(a => a.logicalKey.startsWith("phenom-page-")).map(a => JSON.parse(a.body as string)), null, 2),
  "synthetic-plan.json": JSON.stringify(input.plan, null, 2),
  "synthetic-normalized-jobs.json": JSON.stringify(input.result.jobs, null, 2),
  "synthetic-atomic-commit.json": JSON.stringify(fixture.commit, null, 2),
  "synthetic-admission.json": JSON.stringify(fixture.admission, null, 2)
};
for (const [name, body] of Object.entries(files)) await writeFile(join(workspaceRoot, name), body + "\n", {flag: "wx"});
const report = {
  classification: LILLY_SYNTHETIC_FIXTURE_KIND, networkAccess: false, databaseWrites: false,
  reusableGenerator: "node --import tsx scripts/verify-lilly-synthetic.ts <new-directory>",
  limitation: "Invented jobs/IDs and synthetic runtime hashes. Serialized receipts lose issuer ownership and cannot authorize new admission or production writes.",
  sourceConfigSha256: input.binding.sourceConfigSha256, rows: input.result.jobs.length,
  cityCounts: Object.fromEntries(["城市待核", "上海"].map(city => [city, input.result.jobs.filter(j => j.cities.includes(city)).length])),
  exactDatesKnown: input.result.jobs.filter(j => j.officialPublishedAt !== undefined).length,
  temporalEligibilityWindowProven: false, ageExclusions: 0,
  oldOfficialDatesRetained: input.result.jobs.filter(j => j.officialPublishedAt! < "2026-04-01").length,
  syntheticAdmission: fixture.admission.status, atomicBindingVerified: true,
  files: Object.entries(files).map(([path, body]) => ({path, sha256: createHash("sha256").update(body + "\n").digest("hex")})),
  artifacts: input.archive.artifacts.map(a => ({path: a.path, sha256: a.sha256, byteCount: a.byteCount}))
};
await writeFile(join(workspaceRoot, "SYNTHETIC-REPORT.json"), JSON.stringify(report, null, 2) + "\n", {flag: "wx"});
await writeFile(join(workspaceRoot, "README.txt"), `${LILLY_SYNTHETIC_FIXTURE_KIND}\n\nThis is reusable offline test material, not current official jobs, live qualification, database registration, or a deployment receipt. All synthetic exact posted dates are preserved, including four old dates. The synthetic geography mix is 69 city-pending and 19 Shanghai jobs. Time-window eligibility is not asserted. No age filter or closure inference is applied.\n\nRegenerate with: node --import tsx scripts/verify-lilly-synthetic.ts <new-directory>\nRun the complete in-memory atomic repository fixture with: npx vitest run tests/crawler/lillyQualityAdmission.test.ts\n`, {flag: "wx"});
console.log(JSON.stringify(report, null, 2));
