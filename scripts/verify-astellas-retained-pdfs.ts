/** Offline only. Retained external public PDFs are required, never fetched. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { extractAstellasPdfLocationEvidence, replayAstellasPdfLocationEvidence } from "../src/crawler/astellasPdfLocations";
import { sha256Bytes, type SourceFetchArtifactDraft } from "../src/crawler/sourceFetchEvidence";

const root = process.argv[2];
if (!root || process.argv.length !== 3) throw new Error("Usage: node --import tsx scripts/verify-astellas-retained-pdfs.ts <retained-audit-directory>");
const manifestPath = fileURLToPath(new URL("../tests/fixtures/astellas-pdf-locations/retained-manifest.json", import.meta.url));
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { jobs: Array<{ officialTitle: string; officialUrl: string; pdfPath: string; pdfSha256: string; pdfBytes: number; pageCount: number; capturedAt: string; exactLocationLine: string; expectedCities: string[] }> };
assert.equal(manifest.jobs.length, 15);
assert.equal(new Set(manifest.jobs.map(job => job.officialUrl)).size, 15);
const eligibility: Record<string, number> = {};
const results = [];
for (const job of manifest.jobs) {
  assert.match(job.pdfPath, /^pdfs\/[A-Za-z0-9_-]+\.pdf$/u);
  const body = await readFile(resolve(root, job.pdfPath));
  assert.deepEqual(sha256Bytes(body), { sha256: job.pdfSha256, byteCount: job.pdfBytes }, job.officialTitle);
  const key = `astellas-pdf-${sha256Bytes(Buffer.from(job.officialUrl)).sha256}`;
  const artifact: SourceFetchArtifactDraft = { id: key, logicalKey: key, kind: "ATS_PAGE", requestedUrl: job.officialUrl, finalUrl: job.officialUrl, httpStatus: 200, contentType: "application/pdf", capturedAt: job.capturedAt, body, bodyRepresentation: "EXACT", extractorLocator: "ASTELLAS_PDF_LOCATION_V1" };
  const evidence = await extractAstellasPdfLocationEvidence(artifact);
  assert.equal(evidence.result.status, "CITY_SPECIFIC", job.officialTitle);
  assert.equal(evidence.result.nationwide, false);
  assert.equal(evidence.pageCount, job.pageCount);
  assert.equal(evidence.result.fields.length, 1);
  assert.equal(evidence.result.fields[0]!.page, 1);
  assert.equal(evidence.result.fields[0]!.rawLine.trim(), job.exactLocationLine);
  assert.deepEqual(evidence.result.cities, job.expectedCities, job.officialTitle);
  assert.equal(await replayAstellasPdfLocationEvidence(artifact, evidence), true);
  for (const city of evidence.result.cities) eligibility[city] = (eligibility[city] ?? 0) + 1;
  results.push({ officialTitle: job.officialTitle, officialUrl: job.officialUrl, pdfSha256: evidence.pdfSha256, parserVersion: evidence.parserVersion, cities: evidence.result.cities });
}
assert.deepEqual(eligibility, { 北京: 13, 上海: 11, 沈阳: 1 });
console.log(JSON.stringify({ status: "PASS", offline: true, rawBinariesCommitted: false, jobs: results.length, eligibility, results }, null, 2));
