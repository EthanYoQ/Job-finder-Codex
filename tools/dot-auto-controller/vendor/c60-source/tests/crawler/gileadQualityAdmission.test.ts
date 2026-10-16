// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureSyntheticGileadQuality, buildSyntheticGileadAtomicFixture } from "../helpers/gileadQualityFixture";
import { GILEAD_SYNTHETIC_AGES, syntheticGileadBody, syntheticGileadRow } from "../helpers/gileadYello";
import { getSourceQualityPolicy, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { executePortableAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function capture(body?: string) { const root = await mkdtemp(join(tmpdir(), "gilead-synthetic-")); dirs.push(root); return captureSyntheticGileadQuality(root, body); }

describe("synthetic Gilead owned admission and atomic fixture", () => {
  it("admits the exact configuration with all ten replay-bound labels and unknown dates", async () => {
    const input = await capture();
    expect(getSourceQualityPolicy(input.plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    const fixture = await buildSyntheticGileadAtomicFixture(input);
    expect(fixture.admission.receipt.counts).toMatchObject({rawCount: 10, parsedCount: 10, validCount: 10, finalUniqueJobCount: 10, parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0});
    expect(fixture.admission.receipt).not.toHaveProperty("grade");
    expect(fixture.commit.sourceResult.completenessState).toBe("VERIFIED");
    expect(() => verifySourceQualityAtomicCommit({plan: input.plan, commit: fixture.commit})).not.toThrow();
    await expect(verifyAtomicRuntimeCommitForPersistence(fixture.commit)).resolves.toBeUndefined();
    const writes = fixture.commit.commands.filter(c => c.type === "UPSERT_JOB");
    expect(writes).toHaveLength(10);
    expect(writes.map(c => [c.record.officialTitle, c.record.evidence.gileadPublicAge!.rawLabel]).sort()).toEqual(input.result.jobs.map(j => [j.officialTitle, j.evidence.gileadPublicAge!.rawLabel]).sort());
    expect(writes.every(c => c.record.officialPublishedAt === undefined && c.lifecycleStatus === "ACTIVE")).toBe(true);
    expect(input.requests).toHaveLength(1);
  });

  it("executes the complete atomic repository route against an in-memory transaction fixture", async () => {
    const input = await capture(); const {commit} = await buildSyntheticGileadAtomicFixture(input);
    let holder = ""; const events: string[] = []; const jobs: any[] = [];
    const lease = await acquirePortableCrawlLease({$transaction: async work => work({$queryRawUnsafe: async <T>(_sql: string, ...values: unknown[]) => {holder = String(values[1]); return [{holderId: holder}] as T;}})});
    const transaction = {
      $queryRawUnsafe: async (sql: string) => {events.push(sql.startsWith("SELECT") ? "LOCK" : "FENCE"); return sql.startsWith("SELECT") ? [{id: "formal-crawl"}] : [{holderId: holder}];},
      evidenceArtifact: {create: async () => {events.push("ARTIFACT");}}, paginationEvidence: {create: async () => {events.push("PAGE");}},
      lossLedgerEntry: {create: async () => {events.push("LOSS");}}, crawlObservation: {create: async () => {events.push("OBSERVATION");}},
      job: {upsert: async (args: any) => {events.push("JOB"); jobs.push(args);}}, lifecycleSetEvidenceMember: {create: async () => {events.push("LIFECYCLE");}},
      crawlBatchSourceResult: {updateMany: async () => {events.push("TERMINAL"); return {count: 1};}}
    };
    await executePortableAtomicSourceEvidenceCommit(commit, lease, {$transaction: async work => work(transaction as never)});
    expect(events.slice(0, 3)).toEqual(["LOCK", "FENCE", "ARTIFACT"]);
    expect(events.at(-1)).toBe("TERMINAL"); expect(jobs).toHaveLength(10);
    expect(jobs.every(j => j.create.officialPublishedAt === null && j.update.officialPublishedAt === null)).toBe(true);
    expect(jobs.filter(j => j.create.city === "北京")).toHaveLength(2);
    expect(jobs.filter(j => j.create.city === "上海")).toHaveLength(8);
    // Public age is archived and receipt-bound; the current Job schema does not store/display it.
    expect(jobs.every(j => j.create.gileadPublicAge === undefined)).toBe(true);
  });

  it("rejects imported evidence and coherent post-acquisition raw mutation", async () => {
    const input = await capture();
    expect(await issueSourceQualityAdmission({...input, result: structuredClone(input.result)})).toMatchObject({status: "REJECTED", codes: ["OWNED_ACQUISITION_REQUIRED"]});
    input.result.fetchEvidence!.artifacts[0]!.body = syntheticGileadBody([syntheticGileadRow(0, "2y")]);
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status: "REJECTED", codes: ["ACQUISITION_MUTATED"]});
  });

  it("rejects a disappeared archived body before issuing admission", async () => {
    const input = await capture(); await writeFile(join(input.archive.workspaceRoot, input.archive.artifacts[0]!.path), "changed");
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status: "REJECTED", codes: ["ARCHIVE_VERIFICATION_FAILED"]});
  });

  it("retains a 2y label in the admitted output without marking the job closed", async () => {
    const input = await capture(syntheticGileadBody([syntheticGileadRow(0, "2y")])); const {commit} = await buildSyntheticGileadAtomicFixture(input);
    expect(commit.commands.filter(c => c.type === "UPSERT_JOB")).toMatchObject([{lifecycleStatus: "ACTIVE", record: {evidence: {gileadPublicAge: {rawLabel: "2y", classification: {kind: "RELATIVE_YEARS", amount: 2}, timeWindowStatus: "TIME_WINDOW_UNAVAILABLE"}}}}]);
  });

  it("holds invalid labels with reconciled diagnostic losses and no publication writes", async () => {
    const rows = GILEAD_SYNTHETIC_AGES.map((age, i) => syntheticGileadRow(i, i === 4 ? "-1w" : age)); const input = await capture(syntheticGileadBody(rows));
    expect(input.result.truth.completenessVerified).toBe(false);
    expect(input.result.fetchEvidence!.fetchCounts).toEqual({rawCount: 10, parsedCount: 10, validCount: 0, parseDiscardCount: 0, validationDiscardCount: 10});
    expect(input.result.fetchEvidence!.fetchLosses).toHaveLength(10);
    expect(input.result.fetchEvidence!.fetchLosses[4]!.details).toMatchObject({code: "GILEAD_PUBLIC_AGE_INVALID", recordIndex: 4});
    expect(input.result.fetchEvidence!.declaredCompleteness).toBeUndefined();
    const admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("REJECTED");
    expect(buildSourceQualityJobCommands({...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true}).jobCommands).toEqual([]);
  });

  it("refuses source/configuration drift and forged normalized age/country claims", async () => {
    const input = await capture();
    const changed = structuredClone(input.plan); if (changed.adapterId !== "official-json" || changed.officialJsonFetch?.kind !== "yello-job-board") throw Error();
    changed.officialJsonFetch.locationFilterId = 73; expect(getSourceQualityPolicy(changed)).toBeNull();
    input.result.jobs[0]!.locationRaw = "Japan - Tokyo";
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it("blocks an age mutation after atomic construction before entering a transaction", async () => {
    const input = await capture(); const {commit} = await buildSyntheticGileadAtomicFixture(input);
    const command = commit.commands.find(c => c.type === "UPSERT_JOB")!;
    if (command.type !== "UPSERT_JOB") throw Error(); command.record.evidence.gileadPublicAge!.rawLabel = "2y";
    const transaction = vi.fn();
    await expect(executePortableAtomicSourceEvidenceCommit(commit, {} as never, {$transaction: transaction})).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
