// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureSyntheticLillyQuality, buildSyntheticLillyAtomicFixture } from "../helpers/lillyQualityFixture";
import { syntheticLillyRow } from "../helpers/lillyPhenom";
import { getSourceQualityPolicy, issueSourceQualityAdmission, verifySourceQualityAtomicCommit } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { executePortableAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function capture(rows?: Record<string, unknown>[]) { const root = await mkdtemp(join(tmpdir(), "lilly-synthetic-")); dirs.push(root); return captureSyntheticLillyQuality(root, rows); }

describe("synthetic Lilly owned admission and atomic fixture", () => {
  it("admits the exact configuration with synthetic 88 rows and exact dates", async () => {
    const input = await capture();
    expect(getSourceQualityPolicy(input.plan)).toBe("PLAN_BOUND_SOURCE_QUALITY_V1");
    const fixture = await buildSyntheticLillyAtomicFixture(input);
    expect(fixture.admission.receipt.counts).toMatchObject({rawCount: 88, parsedCount: 88, validCount: 88, finalUniqueJobCount: 88, parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0});
    expect(fixture.admission.receipt).not.toHaveProperty("grade");
    expect(fixture.commit.sourceResult.completenessState).toBe("VERIFIED");
    expect(() => verifySourceQualityAtomicCommit({plan: input.plan, commit: fixture.commit})).not.toThrow();
    await expect(verifyAtomicRuntimeCommitForPersistence(fixture.commit)).resolves.toBeUndefined();
    const writes = fixture.commit.commands.filter(c => c.type === "UPSERT_JOB");
    expect(writes).toHaveLength(88);
    expect(writes.map(c => [c.record.officialTitle, c.record.officialPublishedAt, c.record.cities]).sort()).toEqual(input.result.jobs.map(j => [j.officialTitle, j.officialPublishedAt, j.cities]).sort());
    expect(writes.every(c => c.record.officialPublishedAt !== undefined && c.lifecycleStatus === "ACTIVE")).toBe(true);
    expect(input.requests).toHaveLength(3);
  });

  it("executes the complete atomic repository route against an in-memory transaction fixture", async () => {
    const input = await capture(); const {commit} = await buildSyntheticLillyAtomicFixture(input);
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
    expect(events.at(-1)).toBe("TERMINAL"); expect(jobs).toHaveLength(88);
    expect(jobs.every(j => j.create.officialPublishedAt instanceof Date && j.update.officialPublishedAt instanceof Date)).toBe(true);
    expect(jobs.filter(j => j.create.city === "城市待核")).toHaveLength(69);
    expect(jobs.filter(j => j.create.city === "上海")).toHaveLength(19);
    expect(jobs.every(j => j.create.hiringManager === undefined)).toBe(true);
  });

  it("rejects imported evidence and coherent post-acquisition raw mutation", async () => {
    const input = await capture();
    expect(await issueSourceQualityAdmission({...input, result: structuredClone(input.result)})).toMatchObject({status: "REJECTED", codes: ["OWNED_ACQUISITION_REQUIRED"]});
    input.result.fetchEvidence!.artifacts[1]!.body = "changed";
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status: "REJECTED", codes: ["ACQUISITION_MUTATED"]});
  });

  it("rejects a disappeared archived body before issuing admission", async () => {
    const input = await capture(); await writeFile(join(input.archive.workspaceRoot, input.archive.artifacts[0]!.path), "changed");
    expect(await issueSourceQualityAdmission(input)).toMatchObject({status: "REJECTED", codes: ["ARCHIVE_VERIFICATION_FAILED"]});
  });

  it("retains old exact posted dates in active atomic publication", async () => {
    const input = await capture([syntheticLillyRow()]); const {commit} = await buildSyntheticLillyAtomicFixture(input);
    expect(commit.commands.filter(c => c.type === "UPSERT_JOB")).toMatchObject([{lifecycleStatus: "ACTIVE", record: {officialPublishedAt: "2025-11-12T00:00:00.000Z"}}]);
  });

  it("holds invalid geography without publication commands", async () => {
    const input = await capture([syntheticLillyRow(0, {workLocations: [{country: "Singapore"}]})]);
    expect(input.result.truth.completenessVerified).toBe(false);
    const admission = await issueSourceQualityAdmission(input); expect(admission.status).toBe("REJECTED");
    expect(buildSourceQualityJobCommands({...input, admission, previousJobs: [], firstAcceptedCurrentPolicyReceipt: null, baselineCompletedBeforeCrawl: true}).jobCommands).toEqual([]);
  });

  it("refuses source/configuration drift and forged normalized city/country claims", async () => {
    const input = await capture();
    const changed = structuredClone(input.plan); if (changed.adapterId !== "official-json" || changed.officialJsonFetch?.kind !== "phenom") throw Error();
    changed.officialJsonFetch.countryFilter = "Singapore"; expect(getSourceQualityPolicy(changed)).toBeNull();
    input.result.jobs[0]!.locationRaw = "Japan - Tokyo";
    expect((await issueSourceQualityAdmission(input)).status).toBe("REJECTED");
  });

  it("blocks a date mutation after atomic construction before entering a transaction", async () => {
    const input = await capture(); const {commit} = await buildSyntheticLillyAtomicFixture(input);
    const command = commit.commands.find(c => c.type === "UPSERT_JOB")!;
    if (command.type !== "UPSERT_JOB") throw Error(); command.record.officialPublishedAt = "2001-01-01T00:00:00.000Z";
    const transaction = vi.fn();
    await expect(executePortableAtomicSourceEvidenceCommit(commit, {} as never, {$transaction: transaction})).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
