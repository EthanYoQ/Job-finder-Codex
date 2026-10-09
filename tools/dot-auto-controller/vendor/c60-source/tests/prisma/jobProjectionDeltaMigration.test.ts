// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  JOB_PROJECTION_FIELDS, canonicalProjectionJson, hashJobPersistedProjection,
  hashProjectionJson, sortJobProjectionMembers, type JobProjectionDeltaReceipt
} from "../../src/domain/jobProjectionDeltaReceipt";

const migration = readFileSync(resolve("prisma/migrations/20261006172300_job_projection_delta_contract/migration.sql"), "utf8");
const baseline = readFileSync(resolve("prisma/migrations/20261003055000_jnj_dom_evidence_admission/migration.sql"), "utf8");
const baselinePolicy = readFileSync(resolve("prisma/migrations/20261001120000_portable_source_quality_policy/migration.sql"), "utf8");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sourceBody = (sql: string) => sql.split("AS $function$")[1]!.split("$function$;")[0]!;
const section = (name: string) => {
  const start = `    -- BEGIN JOB DELTA ${name}\n`, end = `    -- END JOB DELTA ${name}\n`;
  return migration.slice(migration.indexOf(start), migration.indexOf(end) + end.length);
};
const declarations = section("DECLARATIONS"), gate = section("RECEIPT GATE"), restore = section("RECEIPT RESTORE");

describe("SQL48 job projection delta migration invariants", () => {
  it("retains every original SQL48 byte, including JNJ admission and terminal immutability", () => {
    expect(sourceBody(migration).replace(declarations, "").replace(gate, "").replace(restore, "")).toBe(sourceBody(baseline));
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.enforce_source_result_state_machine\(\)/gu)).toHaveLength(1);
    expect(sourceBody(migration).match(/RETURN NEW;/gu)).toHaveLength(1);
    expect(sourceBody(migration).indexOf("Terminal CrawlBatchSourceResult rows are immutable"))
      .toBeLessThan(sourceBody(migration).indexOf("BEGIN JOB DELTA RECEIPT GATE"));
    expect(migration).toContain(hash(sourceBody(baseline)));
    expect(migration).not.toContain("('source-lilly-china-social','company-lilly-china'");
  });

  it("adds only nullable change metadata and pure restricted helpers", () => {
    expect(migration).toContain('ALTER TABLE public."Job" ADD COLUMN "sourceChangedAt" TIMESTAMP(3);');
    expect(migration).not.toMatch(/CREATE TABLE|ALTER TYPE|INSERT INTO|DELETE FROM|UPDATE\s+(?:public\.)?"/u);
    expect(migration.match(/IMMUTABLE STRICT SECURITY INVOKER/gu)).toHaveLength(2);
    expect(migration.match(/REVOKE ALL ON FUNCTION/gu)).toHaveLength(4);
    expect(migration.replace(/--[^\n]*/gu, "")).not.toContain("SECURITY DEFINER");
    expect(migration).not.toContain("GRANT ");
    expect(migration).not.toContain("_prisma_migrations");
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
  });

  it("uses exactly the shared source-owned persisted projection", () => {
    const projection = migration.split("'projection', jsonb_build_object(")[1]!.split("\n        )")[0]!;
    const fields = [...projection.matchAll(/'([A-Za-z]+)',/gu)].map(match => match[1]);
    expect(fields).toEqual([...JOB_PROJECTION_FIELDS]);
    for (const field of ["sourceChangedAt", "lastSeenAt", "category", "auxiliaryChineseTitle", "humanCorrectedTitle", "classificationConfidence"])
      expect(projection).not.toContain(field);
    expect(projection).toContain('to_char(job."officialPublishedAt", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')');
    expect(migration).toContain("ORDER BY convert_to(e.key, 'UTF8')");
  });

  it("checks hashes, full persisted tuples, paired members, and observation history before unwrapping", () => {
    for (const code of ["JOB_DELTA_RECEIPT_SHAPE_OR_BINDING", "JOB_DELTA_RECEIPT_HASH_MISMATCH", "JOB_DELTA_OBSERVATION_MISMATCH",
      "JOB_DELTA_MANIFEST_HASH_MISMATCH", "JOB_DELTA_MEMBER_CARDINALITY", "JOB_DELTA_LSEM_MISMATCH", "JOB_DELTA_PERSISTED_PROJECTION_MISMATCH",
      "JOB_DELTA_CURRENT_OBSERVATION_MISMATCH", "JOB_DELTA_GRACE_HISTORY_MISSING", "JOB_DELTA_GRACE_OBSERVATION_MISMATCH",
      "JOB_DELTA_GRACE_PRIOR_RECEIPT_MISMATCH", "JOB_DELTA_GRACE_LEGACY_LAST_SEEN_MISMATCH", "JOB_DELTA_MEMBER_PAIR_MISMATCH"])
      expect(gate).toContain(code);
    expect(gate).toContain('m."releaseCandidateId" = NEW."releaseCandidateId" AND m."batchId" = NEW."batchId" AND m."sourceId" = NEW."sourceId" AND m."sourceResultId" = NEW."id"');
    expect(gate).toContain('s."companyId" = j."companyId"');
    expect(gate).toContain('NEW."completenessCertificate" := delta_receipt->\'legacyCertificate\'');
    expect(restore).toContain('NEW."completenessCertificateSha256" := delta_receipt_sha256');
  });
});

// Opt-in existing PostgreSQL-WASM, entirely in-process. Never use a connection
// string, an external database, network, or an installer for this suite.
const modulePath = process.env.PGLITE_MODULE;
type Row = Record<string, unknown>;
const tuple = { releaseCandidateId: "rc", batchId: "batch", sourceId: "source", sourceResultId: "result" };
const verifiedAt = "2026-10-06T10:00:00.000Z", observedAt = "2026-10-06T09:59:00.000Z";
const priorVerifiedAt = "2026-10-05T10:00:00.000Z", priorObservedAt = "2026-10-05T09:59:00.000Z";
function fixture(grace = false): { receipt: JobProjectionDeltaReceipt; job: Row; dbMembers: Row[]; observations: Row[]; history: Row[] } {
  const job: Row = { id: "job", companyId: "company", sourceId: tuple.sourceId, dedupeKey: "job-key", sourceJobId: "official-id",
    officialTitle: "工程师 🧪", officialUrl: "https://example.test/job", listUrl: null, locationRaw: "上海", city: "上海", cities: ["上海"],
    officialPublishedAt: "2026-09-01T00:00:00.000Z", missingSuccessCount: grace ? 1 : 0,
    lifecycleStatus: "ACTIVE", visibleInFrontend: true, isNew: false, lastSeenAt: priorVerifiedAt,
    auxiliaryChineseTitle: "保留辅助标题", category: "研发", humanCorrectedTitle: "保留人工标题", sourceChangedAt: null };
  const kinds = grace ? ["GRACE", "VISIBLE"] as const : ["CURRENT", "VISIBLE"] as const;
  const members = sortJobProjectionMembers(kinds.map(setKind => ({ ...tuple, setKind, jobKey: "job-key", jobKeySha256: hash("job-key"),
    lifecycleStatus: "ACTIVE" as const, missingCount: grace ? 1 as const : 0 as const, jobProjectionSha256: hashJobPersistedProjection(job),
    lastConfirmedObservedAt: grace ? priorObservedAt : observedAt, lifecycleLastSeenAt: grace ? priorVerifiedAt : verifiedAt,
    lastPresentResultId: grace ? "prior-result" : tuple.sourceResultId })));
  const legacyCertificate = { schemaVersion: "synthetic-legacy-for-delta-gate-test", counts: { finalUniqueJobCount: grace ? 0 : 1 } };
  const receipt: JobProjectionDeltaReceipt = { schemaVersion: "job-projection-delta-receipt-v1", projectionSchemaVersion: "job-persisted-projection-v1",
    binding: tuple, verifiedAt, observedAt, legacyCertificate, legacyCertificateSha256: hashProjectionJson(legacyCertificate),
    detailEvidenceState: "UNKNOWN", members, manifestSha256: hashProjectionJson(members) };
  const dbMembers: Row[] = members.map(({ jobProjectionSha256, lastConfirmedObservedAt, lifecycleLastSeenAt, lastPresentResultId, ...m }) => m);
  const observations: Row[] = [{ ...tuple, crawledAt: observedAt }];
  const history: Row[] = [];
  if (grace) {
    const priorTuple = { ...tuple, batchId: "prior-batch", sourceResultId: "prior-result" };
    dbMembers.push({ ...priorTuple, setKind: "CURRENT", jobKey: "job-key", jobKeySha256: hash("job-key"), lifecycleStatus: "ACTIVE", missingCount: 0 });
    observations.push({ ...priorTuple, crawledAt: priorObservedAt, successful: true, transportSucceeded: true, adapterSucceeded: true,
      atomicCommitSucceeded: true, completenessVerified: true });
    history.push({ ...priorTuple, id: priorTuple.sourceResultId, atomicCommitState: "COMMITTED", completenessState: "VERIFIED", finishedAt: priorVerifiedAt,
      completenessCertificate: { schemaVersion: "synthetic-legacy" } });
  }
  return { receipt, job, dbMembers, observations, history };
}
type Fixture = ReturnType<typeof fixture>;

describe.skipIf(!modulePath)("delta gate and helpers in actual in-memory PostgreSQL", () => {
  let db: { exec: (sql: string) => Promise<unknown>; query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>; close: () => Promise<void> };
  let originalBaselineDefinition: string;
  let effectiveBaselineDefinition: string;
  beforeAll(async () => {
    const { PGlite } = createRequire(import.meta.url)(modulePath!.replace(/\.js$/u, ".cjs"));
    db = new PGlite();
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gmu)].map(match => match[1]));
    await db.exec('CREATE TYPE public."CompletenessStatus" AS ENUM (\'PENDING\',\'VERIFIED\',\'NEEDS_MANUAL_COMPLETENESS_REVIEW\',\'INCOMPLETE\',\'FAILED\')');
    const types: Record<string, string> = { String: "text", Int: "integer", Float: "double precision", DateTime: "timestamp", Boolean: "boolean", Json: "jsonb", CompletenessStatus: 'public."CompletenessStatus"' };
    for (const name of ["Job", "RecruitmentSource", "CrawlObservation", "LifecycleSetEvidenceMember", "CrawlBatchSourceResult"]) {
      const body = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))![1]!;
      const columns = [...body.matchAll(/^\s+(\w+)\s+(\w+)(\[\]|\?)?/gmu)].flatMap(([, key, type, suffix]) => {
        if (key === "sourceChangedAt") return []; // The actual candidate migration must add it.
        const sqlType = types[type!] ?? (enums.has(type) ? "text" : undefined);
        return sqlType ? [`"${key}" ${sqlType}${suffix === "[]" ? "[]" : ""}`] : [];
      });
      await db.exec(`CREATE TABLE public."${name}" (${columns.join(",")})`);
    }
    const baselineDefinition = baseline.slice(baseline.indexOf("CREATE OR REPLACE FUNCTION"), baseline.lastIndexOf("$function$;") + "$function$;".length);
    await db.exec(baselineDefinition);
    const originalCheck = baselinePolicy.slice(baselinePolicy.indexOf('ALTER TABLE "CrawlBatchSourceResult"\nADD CONSTRAINT "CrawlBatchSourceResult_baseline_transition_shape_check"'), baselinePolicy.lastIndexOf("COMMIT;"));
    await db.exec(originalCheck);
    const readBaselineDefinition = async () => String((await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.\"CrawlBatchSourceResult\"'::regclass AND conname='CrawlBatchSourceResult_baseline_transition_shape_check'")).rows[0]!.definition);
    originalBaselineDefinition = await readBaselineDefinition();
    await db.exec(migration);
    effectiveBaselineDefinition = await readBaselineDefinition();
    // Execute the exact added gate, with its original declarations and restore.
    // The unchanged SQL48 branch is proven byte-identical above, not stubbed into
    // a claim that the complete legacy source policy has been exercised here.
    await db.exec(`CREATE TABLE public."DeltaTestInput" (LIKE public."CrawlBatchSourceResult" INCLUDING CONSTRAINTS);
      CREATE FUNCTION public.test_delta_gate() RETURNS trigger LANGUAGE plpgsql AS $test$
      DECLARE observation_count integer; ${declarations} BEGIN ${gate} ${restore} RETURN NEW; END; $test$;
      CREATE TRIGGER delta_gate BEFORE INSERT ON public."DeltaTestInput" FOR EACH ROW EXECUTE FUNCTION public.test_delta_gate();
      CREATE TRIGGER delta_gate_update BEFORE UPDATE ON public."CrawlBatchSourceResult" FOR EACH ROW EXECUTE FUNCTION public.test_delta_gate();`);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  async function insert(table: string, row: Row) {
    const columns = Object.keys(row).filter(k => k !== "sourceResultId" || table !== "CrawlBatchSourceResult").map(key => `"${key}"`).join(",");
    await db.query(`INSERT INTO public."${table}" (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::public."${table}",$1::jsonb)`, [JSON.stringify(row)]);
  }
  async function admitted(f: Fixture, receipt: unknown = f.receipt, receiptHash?: string) {
    await db.exec("BEGIN");
    try {
      await insert("RecruitmentSource", { id: "source", companyId: "company" });
      await insert("Job", f.job);
      for (const row of f.observations) await insert("CrawlObservation", row);
      for (const row of f.dbMembers) await insert("LifecycleSetEvidenceMember", row);
      for (const row of f.history) await insert("CrawlBatchSourceResult", row);
      await insert("DeltaTestInput", { id: tuple.sourceResultId, releaseCandidateId: tuple.releaseCandidateId, batchId: tuple.batchId, sourceId: tuple.sourceId,
        atomicCommitState: "COMMITTED", completenessState: "VERIFIED", finishedAt: verifiedAt,
        completenessCertificate: receipt, completenessCertificateSha256: receiptHash ?? hashProjectionJson(receipt) });
      const result = (await db.query('SELECT "completenessCertificate", "completenessCertificateSha256" FROM public."DeltaTestInput"')).rows[0]!;
      expect(result.completenessCertificate).toEqual(receipt);
      expect(result.completenessCertificateSha256).toBe(receiptHash ?? hashProjectionJson(receipt));
    } finally { await db.exec("ROLLBACK"); }
  }
  function rehash(f: Fixture) {
    f.receipt.members = sortJobProjectionMembers(f.receipt.members);
    f.receipt.manifestSha256 = hashProjectionJson(f.receipt.members);
  }
  async function stageDeferredCommit(f: Fixture, insertJob = true) {
    if (insertJob) {
      await insert("RecruitmentSource", { id: "source", companyId: "company" });
      await insert("Job", f.job);
    }
    for (const row of f.observations) await insert("CrawlObservation", row);
    for (const row of f.dbMembers) await insert("LifecycleSetEvidenceMember", row);
    const b = f.receipt.binding;
    await insert("CrawlBatchSourceResult", { id: b.sourceResultId, releaseCandidateId: b.releaseCandidateId, batchId: b.batchId,
      sourceId: b.sourceId, atomicCommitState: "PENDING", completenessState: "PENDING" });
    await db.query('UPDATE public."CrawlBatchSourceResult" SET "atomicCommitState"=\'COMMITTED\', "completenessState"=\'VERIFIED\', "finishedAt"=$2::timestamp, "completenessCertificate"=$3::jsonb, "completenessCertificateSha256"=$4 WHERE id=$1',
      [b.sourceResultId, f.receipt.verifiedAt, JSON.stringify(f.receipt), hashProjectionJson(f.receipt)]);
  }
  async function cleanCommitFixtures() {
    await db.exec('TRUNCATE public."CrawlBatchSourceResult",public."CrawlObservation",public."LifecycleSetEvidenceMember",public."Job",public."RecruitmentSource"');
  }
  function nextFixture(f: Fixture, suffix: string): Fixture {
    const next = structuredClone(f);
    const binding = { ...tuple, batchId: `batch-${suffix}`, sourceResultId: `result-${suffix}` };
    next.receipt.binding = binding;
    next.receipt.verifiedAt = "2026-10-06T11:00:00.000Z"; next.receipt.observedAt = "2026-10-06T10:59:00.000Z";
    next.receipt.members = sortJobProjectionMembers(next.receipt.members.map(m => ({ ...m, ...binding,
      lastPresentResultId: binding.sourceResultId, lifecycleLastSeenAt: next.receipt.verifiedAt,
      lastConfirmedObservedAt: next.receipt.observedAt, jobProjectionSha256: hashJobPersistedProjection(next.job) })));
    next.receipt.manifestSha256 = hashProjectionJson(next.receipt.members);
    next.observations = [{ ...binding, crawledAt: next.receipt.observedAt }];
    next.dbMembers = next.dbMembers.map(m => ({ ...m, ...binding }));
    return next;
  }

  it("installs exactly the candidate trigger body", async () => {
    const result = await db.query("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS hash FROM pg_proc WHERE oid='public.enforce_source_result_state_machine()'::regprocedure");
    expect(result.rows[0]!.hash).toBe(hash(sourceBody(migration)));
  });
  it("defers one terminal-wrapper trigger event until actual commit", async () => {
    const result = await db.query("SELECT tgenabled,tgdeferrable,tginitdeferred,pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='public.\"CrawlBatchSourceResult\"'::regclass AND tgname='CrawlBatchSourceResult_delta_commit_projection'");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ tgenabled: "O", tgdeferrable: true, tginitdeferred: true });
    expect(result.rows[0]!.definition).toContain("AFTER UPDATE");
    expect(result.rows[0]!.definition).toContain("old.\"atomicCommitState\"");
    expect(result.rows[0]!.definition).toContain("job-projection-delta-receipt-v1");
  });
  it("rolls back all publication rows when a later statement changes a bound Job before COMMIT", async () => {
    await cleanCommitFixtures();
    await db.exec("BEGIN");
    try {
      await stageDeferredCommit(fixture());
      await db.exec('UPDATE public."Job" SET "officialTitle"=\'late mutation after receipt admission\'');
      // The BEFORE gate succeeded; only the real deferred event can catch this.
      expect((await db.query('SELECT "atomicCommitState" FROM public."CrawlBatchSourceResult"')).rows).toEqual([{ atomicCommitState: "COMMITTED" }]);
      await expect(db.exec("COMMIT")).rejects.toThrow("JOB_DELTA_COMMIT_PROJECTION_MISMATCH");
      for (const table of ["CrawlBatchSourceResult", "CrawlObservation", "LifecycleSetEvidenceMember", "Job"])
        expect((await db.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows).toEqual([{ count: 0 }]);
    } finally { await db.exec("ROLLBACK"); await cleanCommitFixtures(); }
  });
  it("rejects a manifest Job deleted later in the publication transaction", async () => {
    await cleanCommitFixtures(); await db.exec("BEGIN");
    try {
      await stageDeferredCommit(fixture()); await db.exec('DELETE FROM public."Job"');
      await expect(db.exec("COMMIT")).rejects.toThrow("JOB_DELTA_COMMIT_JOB_MISSING");
      expect((await db.query('SELECT count(*)::int AS count FROM public."CrawlBatchSourceResult"')).rows).toEqual([{ count: 0 }]);
    } finally { await db.exec("ROLLBACK"); await cleanCommitFixtures(); }
  });
  it("commits another unchanged observation without writing Job and without revisiting old receipts", async () => {
    await cleanCommitFixtures();
    try {
      const first = fixture(); await db.exec("BEGIN"); await stageDeferredCommit(first); await db.exec("COMMIT");
      const before = (await db.query('SELECT xmin::text AS version,to_jsonb(j) AS row FROM public."Job" j')).rows;
      await db.exec("BEGIN"); await stageDeferredCommit(nextFixture(first, "unchanged"), false); await db.exec("COMMIT");
      expect((await db.query('SELECT xmin::text AS version,to_jsonb(j) AS row FROM public."Job" j')).rows).toEqual(before);
      expect((await db.query('SELECT count(*)::int AS count FROM public."CrawlBatchSourceResult" WHERE "atomicCommitState"=\'COMMITTED\'')).rows).toEqual([{ count: 2 }]);
    } finally { await db.exec("ROLLBACK"); await cleanCommitFixtures(); }
  });
  it("allows a later transaction to publish a legitimate new projection while the old result stays committed", async () => {
    await cleanCommitFixtures();
    try {
      const first = fixture(); await db.exec("BEGIN"); await stageDeferredCommit(first); await db.exec("COMMIT");
      const oldHash = hashProjectionJson(first.receipt);
      const changed = structuredClone(first); changed.job.officialTitle = "new source title in a later transaction";
      const next = nextFixture(changed, "changed");
      await db.exec("BEGIN"); await db.query('UPDATE public."Job" SET "officialTitle"=$1', [next.job.officialTitle]);
      await stageDeferredCommit(next, false); await db.exec("COMMIT");
      expect((await db.query('SELECT "atomicCommitState","completenessCertificateSha256" FROM public."CrawlBatchSourceResult" WHERE id=$1', [first.receipt.binding.sourceResultId])).rows)
        .toEqual([{ atomicCommitState: "COMMITTED", completenessCertificateSha256: oldHash }]);
      expect((await db.query('SELECT "officialTitle" FROM public."Job"')).rows).toEqual([{ officialTitle: next.job.officialTitle }]);
    } finally { await db.exec("ROLLBACK"); await cleanCommitFixtures(); }
  });
  it("allows a later human overlay in the same transaction because it is outside the source projection", async () => {
    await cleanCommitFixtures(); await db.exec("BEGIN");
    try {
      await stageDeferredCommit(fixture());
      await db.exec('UPDATE public."Job" SET "humanCorrectedTitle"=\'human overlay after admission\'');
      await db.exec("COMMIT");
      expect((await db.query('SELECT "humanCorrectedTitle" FROM public."Job"')).rows).toEqual([{ humanCorrectedTitle: "human overlay after admission" }]);
    } finally { await db.exec("ROLLBACK"); await cleanCommitFixtures(); }
  });
  it("retains the baseline constraint under its original name and every original comparison", async () => {
    const effectiveOperand = 'job_delta_effective_legacy_certificate("completenessCertificate", "completenessCertificateSha256", jsonb_build_object(\'releaseCandidateId\', "releaseCandidateId", \'batchId\', "batchId", \'sourceId\', "sourceId", \'sourceResultId\', id), "finishedAt")';
    expect(effectiveBaselineDefinition.replaceAll(effectiveOperand, '"completenessCertificate"')).toBe(originalBaselineDefinition);
    expect((await db.query("SELECT convalidated FROM pg_constraint WHERE conrelid='public.\"CrawlBatchSourceResult\"'::regclass AND conname='CrawlBatchSourceResult_baseline_transition_shape_check'")).rows).toEqual([{ convalidated: true }]);
  });
  it.each([
    ["OFFICIAL_EVIDENCE_CONFIRMED", { schemaVersion: "a-grade-official-total-v2", grade: "A" }],
    ["INDEPENDENT_VALIDATION_CONFIRMED", { schemaVersion: "b-grade-independent-traversal-v2", grade: "B" }],
    ["PLAN_BOUND_REPLAY_CONFIRMED", { schemaVersion: "plan-bound-source-quality-v1", policyId: "PLAN_BOUND_SOURCE_QUALITY_V1" }]
  ])("preserves original %s baseline rules for wrapped and legacy certificates", async (prefix, legacyCertificate) => {
    for (const [suffix, priorCount, count, allowed] of [
      ["INITIAL", null, 1, true], ["INCREASE", 1, 2, true], ["DECREASE", 2, 1, true], ["UNCHANGED", 1, 1, true],
      ["INCREASE", 2, 1, false], ["DECREASE", 1, 2, false], ["UNCHANGED", 1, 2, false]
    ] as const) {
      const f = fixture(); f.receipt.legacyCertificate = legacyCertificate as Record<string, unknown>;
      f.receipt.legacyCertificateSha256 = hashProjectionJson(legacyCertificate);
      const row = { id: tuple.sourceResultId, releaseCandidateId: tuple.releaseCandidateId, batchId: tuple.batchId, sourceId: tuple.sourceId,
        finishedAt: verifiedAt, completenessState: "VERIFIED", baselineChangeReason: `${prefix}_${suffix}`,
        baselinePreviousSourceResultId: priorCount === null ? null : "prior-result", baselinePreviousJobCount: priorCount, dedupeOutputCount: count };
      for (const wrapped of [false, true]) {
        const certificate = wrapped ? f.receipt : legacyCertificate;
        const expression = (wrapped ? effectiveBaselineDefinition : originalBaselineDefinition).replace(/^CHECK /u, "");
        const actual = await db.query(`SELECT (${expression}) IS NOT FALSE AS allowed FROM jsonb_populate_record(NULL::public."CrawlBatchSourceResult",$1::jsonb) AS r`,
          [JSON.stringify({ ...row, completenessCertificate: certificate, completenessCertificateSha256: hashProjectionJson(certificate) })]);
        expect(actual.rows).toEqual([{ allowed }]);
      }
    }
  });
  it.each(["binding", "verifiedAt", "legacyCertificateSha256", "schemaVersion"])("rejects an invalid effective legacy envelope %s", async key => {
    const f = fixture(); (f.receipt as unknown as Row)[key] = key === "binding" ? { ...tuple, batchId: "wrong" } : key === "verifiedAt" ? priorVerifiedAt : null;
    await expect(db.query("SELECT public.job_delta_effective_legacy_certificate($1::jsonb,$2,$3::jsonb,$4::timestamp)",
      [JSON.stringify(f.receipt), hashProjectionJson(f.receipt), JSON.stringify(tuple), verifiedAt])).rejects.toThrow("JOB_DELTA_EFFECTIVE_LEGACY_ENVELOPE_INVALID");
  });
  it.each([null, true, "中🧪\n\"\\", [], {}, [1, -0, 1.25, 0.000001, 0.0000001, 1e20, 1e21, -1e22],
    { "🧪": [null, false], "中": "数据", "a": { z: 2, aa: "a" }, "é": 0 }].map(value => [value]))("matches canonical UTF-8 JSON for %j", async value => {
    const result = await db.query("SELECT public.job_projection_canonical_json($1::jsonb) AS canonical", [JSON.stringify(value)]);
    expect(result.rows[0]!.canonical).toBe(canonicalProjectionJson(value));
  });
  it("accepts CURRENT with a retained older Job.lastSeenAt and restores the outer certificate", async () => admitted(fixture()));
  it("accepts GRACE only through its real historical CURRENT and observation", async () => admitted(fixture(true)));
  it("accepts a prior delta CURRENT anchor while Job.lastSeenAt predates that observation", async () => {
    const f = fixture(true), previous = fixture().receipt;
    previous.binding = { ...tuple, batchId: "prior-batch", sourceResultId: "prior-result" };
    previous.verifiedAt = priorVerifiedAt; previous.observedAt = priorObservedAt;
    previous.members = sortJobProjectionMembers(previous.members.map(member => ({ ...member, ...previous.binding,
      lastConfirmedObservedAt: priorObservedAt, lifecycleLastSeenAt: priorVerifiedAt, lastPresentResultId: "prior-result" })));
    previous.manifestSha256 = hashProjectionJson(previous.members);
    f.history[0]!.completenessCertificate = previous;
    f.history[0]!.completenessCertificateSha256 = hashProjectionJson(previous);
    f.job.lastSeenAt = "2026-10-01T00:00:00.000Z";
    await admitted(f);
  });
  it("keeps manual, category, auxiliary, and change-time metadata outside the hash", async () => {
    const f = fixture(); f.job.category = "质量"; f.job.humanCorrectedTitle = "修改的人工作业";
    f.job.auxiliaryChineseTitle = "另一标题"; f.job.sourceChangedAt = "2020-01-01T00:00:00.000Z";
    await admitted(f);
  });
  it("rejects an outer checksum mismatch", async () => { await expect(admitted(fixture(), undefined, "0".repeat(64))).rejects.toThrow("JOB_DELTA_RECEIPT_HASH_MISMATCH"); });
  it.each([null, [], 1, "bad", { schemaVersion: null, members: [] }, { schemaVersion: "job-projection-delta-receipt-v99" }])("fails closed on malformed wrapper %j", async value => {
    await expect(admitted(fixture(), value)).rejects.toThrow(/JOB_DELTA_/u);
  });
  const mutations: Array<[string, (f: Fixture) => void]> = [
    ["unknown top-level field", f => { (f.receipt as unknown as Row).unknown = true; }],
    ["wrong binding", f => { f.receipt.binding = { ...tuple, batchId: "other" }; }],
    ["unknown detail evidence", f => { (f.receipt as unknown as Row).detailEvidenceState = "VERIFIED"; }],
    ["wrong verified time", f => { f.receipt.verifiedAt = priorVerifiedAt; }],
    ["rewritten observation", f => { f.observations[0]!.crawledAt = verifiedAt; }],
    ["missing observation", f => { f.observations = []; }],
    ["duplicate observation", f => { f.observations.push(f.observations[0]!); }],
    ["altered inner checksum", f => { f.receipt.legacyCertificateSha256 = "0".repeat(64); }],
    ["nested receipt", f => { f.receipt.legacyCertificate.schemaVersion = f.receipt.schemaVersion; f.receipt.legacyCertificateSha256 = hashProjectionJson(f.receipt.legacyCertificate); }],
    ["missing persisted member", f => { f.dbMembers.pop(); }],
    ["extra persisted member", f => { f.dbMembers.push({ ...f.dbMembers[0]!, jobKey: "other" }); }],
    ["member from another tuple", f => { f.dbMembers[0]!.releaseCandidateId = "other"; }],
    ["persisted member key hash mismatch", f => { f.dbMembers[0]!.jobKeySha256 = "0".repeat(64); }],
    ["persisted title changed", f => { f.job.officialTitle = "Changed"; }],
    ["persisted company changed", f => { f.job.companyId = "other"; }],
    ["persisted source changed", f => { f.job.sourceId = "other"; }],
    ["persisted lifecycle changed", f => { f.job.missingSuccessCount = 1; }],
    ["persisted visibility changed", f => { f.job.visibleInFrontend = false; }],
    ["member wrong hash", f => { f.receipt.members[0]!.jobKeySha256 = "0".repeat(64); }],
    ["member NULL field", f => { (f.receipt.members[0] as unknown as Row).lastPresentResultId = null; }],
    ["member unknown field", f => { (f.receipt.members[0] as unknown as Row).unknown = "value"; }],
    ["member string count", f => { (f.receipt.members[0] as unknown as Row).missingCount = "0"; }],
    ["member wrong tuple", f => { f.receipt.members[0]!.batchId = "other"; }],
    ["CURRENT backdated observation", f => { f.receipt.members[0]!.lastConfirmedObservedAt = priorObservedAt; }],
    ["CURRENT backdated lifecycle anchor", f => { f.receipt.members[0]!.lifecycleLastSeenAt = priorVerifiedAt; }],
    ["CURRENT other last result", f => { f.receipt.members[0]!.lastPresentResultId = "prior-result"; }],
    ["unpaired VISIBLE", f => { f.receipt.members.shift(); f.dbMembers.shift(); }],
    ["duplicate receipt member", f => { f.receipt.members.push(f.receipt.members[0]!); f.dbMembers.push(f.dbMembers[0]!); }]
  ];
  it.each(mutations)("rejects %s even after manifest and outer rehash", async (_name, mutate) => {
    const f = fixture(); mutate(f); rehash(f); await expect(admitted(f)).rejects.toThrow(/JOB_DELTA_/u);
  });
  it("rejects unsorted members even with their own root checksum", async () => {
    const f = fixture(); f.receipt.members.reverse(); f.receipt.manifestSha256 = hashProjectionJson(f.receipt.members);
    await expect(admitted(f)).rejects.toThrow("JOB_DELTA_MANIFEST_HASH_MISMATCH");
  });
  it("rejects a NULL manifest even after outer rehash", async () => {
    const f = fixture(); (f.receipt as unknown as Row).manifestSha256 = null;
    await expect(admitted(f)).rejects.toThrow("JOB_DELTA_RECEIPT_SHAPE_OR_BINDING");
  });
  const graceMutations: Array<[string, (f: Fixture) => void]> = [
    ["missing historical result", f => { f.history = []; }],
    ["unverified historical result", f => { f.history[0]!.completenessState = "INCOMPLETE"; }],
    ["wrong historical source", f => { f.history[0]!.sourceId = "other"; }],
    ["historical GRACE instead of CURRENT", f => { f.dbMembers.at(-1)!.setKind = "GRACE"; }],
    ["wrong historical member tuple", f => { f.dbMembers.at(-1)!.batchId = "other"; }],
    ["wrong original observation", f => { f.observations.at(-1)!.crawledAt = verifiedAt; }],
    ["legacy lastSeen drift", f => { f.job.lastSeenAt = verifiedAt; }],
    ["nonhistorical anchor", f => { f.history[0]!.finishedAt = verifiedAt; }],
    ["fabricated delta history", f => { f.history[0]!.completenessCertificate = { schemaVersion: "job-projection-delta-receipt-v1", members: [] }; }]
  ];
  it.each(graceMutations)("rejects GRACE with %s", async (_name, mutate) => {
    const f = fixture(true); mutate(f); await expect(admitted(f)).rejects.toThrow(/JOB_DELTA_/u);
  });
});
