import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseStrictZonedIso100ns, phase2ManifestContentHash, validatePhase2AggregateManifest, type Phase2AggregateManifest }
  from "../../src/evidence/phase2AggregateManifest";
import { validateExternalEvidenceRoot } from "../../src/evidence/externalEvidenceValidator";

const validatedEvidenceRoot = validateExternalEvidenceRoot();

function valid(): Phase2AggregateManifest {
  return JSON.parse(validatedEvidenceRoot.text("outputs/p0-rc/p0-rc-20260710-001/phase-2/phase-2-aggregate-freeze-manifest.json"));
}

function reseal(value: Phase2AggregateManifest): void {
  const { integrity: _old, ...content } = value; value.integrity = { contentSha256: phase2ManifestContentHash(content) };
}

function mutateCompanion(report: any, mutate: (content: any) => void): void {
  const content = JSON.parse(report.companionRaw); mutate(content);
  report.companionRaw = `${JSON.stringify(content, null, 2)}\n`;
  report.bytes = Buffer.byteLength(report.companionRaw);
  report.physicalSha256 = createHash("sha256").update(report.companionRaw).digest("hex");
}
function explicitNow(value: Phase2AggregateManifest): Date { return new Date(Date.parse(value.capturedAt) + 1); }

describe("Phase 2 aggregate freeze manifest", () => {
  it.each(["2026-06-31T00:00:00.000Z","2026-04-31T00:00:00.000Z","2025-02-29T00:00:00.000Z",
    "2024-02-30T00:00:00.000Z","2026-01-01T24:00:00.000Z","2026-01-01T00:60:00.000Z",
    "2026-01-01T00:00:60.000Z","2026-01-01T00:00:00.000+24:00","2026-01-01T00:00:00.000+14:01",
    "2026-1-01T00:00:00Z"])("rejects non-normalizing ISO date %s", (value) => {
      expect(() => parseStrictZonedIso100ns(value)).toThrow();
    });
  it.each(["2024-02-29T23:59:59.1234567Z","2026-04-30T00:00:00Z","2026-01-31T00:00:00.000+08:00",
    "2026-01-01T00:00:00.000+14:00","2026-01-01T00:00:00.000-14:00"])("accepts exact valid ISO date %s", (value) => {
      expect(() => parseStrictZonedIso100ns(value)).not.toThrow();
    });
  it("validates the append-only RC aggregate artifact", () => {
    const artifact = valid();
    expect(validatePhase2AggregateManifest(artifact, explicitNow(artifact))).toEqual([]);
  });
  it("accepts the exact non-promoted four-batch denominator", () => { const value=valid(); expect(validatePhase2AggregateManifest(value,explicitNow(value))).toEqual([]); });
  it.each([
    ["missing", (value: any) => value.batches.pop()],
    ["duplicate", (value: any) => value.batches[3].batchId = "F01"],
    ["drift", (value: any) => value.batches[0].promotionCount = 1],
    ["semantic mismatch", (value: any) => value.batches[0].semanticSha256 = "b".repeat(64)],
    ["stale pass", (value: any) => value.qaReports[0].capturedAt = "2026-07-11T09:00:00.000Z"],
    ["duplicate report", (value: any) => value.qaReports.push({ ...value.qaReports[0], id: "duplicate" })],
    ["merged hash mismatch", (value: any) => value.merged.semanticSha256 = "b".repeat(64)],
    ["companion unknown key", (value: any) => mutateCompanion(value.qaReports[0], (content) => { content.unknown = true; })],
    ["companion semantic tamper", (value: any) => mutateCompanion(value.qaReports[0], (content) => { content.currentF01.semanticSha256 = "b".repeat(64); })],
    ["companions disagree on merge", (value: any) => mutateCompanion(value.qaReports[1], (content) => { content.merge.semanticSha256 = "b".repeat(64); })],
    ["old report hash", (value: any) => value.qaReports[2].originalReport.physicalSha256 = "b".repeat(64)],
    ["future companion", (value: any) => { value.qaReports[3].capturedAt = new Date(Date.parse(value.capturedAt) + 1).toISOString(); mutateCompanion(value.qaReports[3], (content) => { content.capturedAt = value.qaReports[3].capturedAt; }); }]
  ])("rejects %s after a valid reseal", (_label, mutate) => {
    const value: any = valid(); mutate(value); reseal(value);
    expect(validatePhase2AggregateManifest(value, explicitNow(value)).length).toBeGreaterThan(0);
  });
  it("rejects self-hash tampering", () => { const value = valid(); value.git.dirtyEntryCount += 1;
    expect(validatePhase2AggregateManifest(value, explicitNow(value))).toContain("SELF_HASH_MISMATCH"); });

  it.each(["lower", "upper"])("accepts the exact %s capture boundary", (boundary) => {
    const value:any=valid(); const report=value.qaReports[0];
    const capturedAt=boundary === "lower" ? value.batches[0].captureCompletedAt : value.capturedAt;
    report.capturedAt=capturedAt; mutateCompanion(report,(content)=>{content.capturedAt=capturedAt}); reseal(value);
    expect(validatePhase2AggregateManifest(value, new Date(Date.parse(value.capturedAt)))).toEqual([]);
  });

  it.each([
    ["lower minus 1ms", (value:any) => new Date(Date.parse(value.batches[0].captureCompletedAt)-1).toISOString()],
    ["upper plus 1ms", (value:any) => new Date(Date.parse(value.capturedAt)+1).toISOString()],
    ["missing timezone", () => "2026-07-11T11:00:00.000"],
    ["invalid precision", () => "2026-07-11T11:00:00.12345678Z"]
  ])("rejects companion time %s after physical and self reseal", (_label,toTime) => {
    const value:any=valid(); const report=value.qaReports[0]; report.capturedAt=toTime(value);
    mutateCompanion(report,(content)=>{content.capturedAt=report.capturedAt}); reseal(value);
    expect(validatePhase2AggregateManifest(value, explicitNow(value)).length).toBeGreaterThan(0);
  });

  it("rejects aggregate capturedAt one millisecond after explicit now", () => {
    const value=valid(); const now=new Date(Date.parse(value.capturedAt)); value.capturedAt=new Date(now.getTime()+1).toISOString(); reseal(value);
    expect(validatePhase2AggregateManifest(value,now)).toContain("AGGREGATE_CAPTURE_FUTURE");
  });
});
