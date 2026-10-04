// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compilePortableAtomicSourceEvidenceSql, inspectPersistedAtomicCommitOutcome, type AtomicSourceEvidenceCommit, type PrismaSourceResultReadDb } from "../../src/db/ingestionRepository";
import { acquirePortableCrawlLease, releasePortableCrawlLease, type PortableLeaseDatabase } from "../../src/crawler/portableCrawlLease";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { ownedPortableFixture } from "./helpers/ownedPortableCommit";

// Explicit opt-in dependency; no package installation or external database.
const modulePath = process.env.PGLITE_MODULE;
describe.skipIf(!modulePath)("local PostgreSQL atomic compiler semantics (not multi-session concurrency)", () => {
  let pg: any;
  let leaseDb: PortableLeaseDatabase;
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!)).href);
    const { pgcrypto } = await import(/* @vite-ignore */ pathToFileURL(resolve(modulePath!, "../contrib/pgcrypto.js")).href);
    pg = await PGlite.create({ extensions: { pgcrypto } });
    for (const name of (await readdir("prisma/migrations")).sort()) {
      // Data-only roster repair requires historical seeded companies, irrelevant to this empty fixture.
      if (name === "migration_lock.toml" || name === "20260927120000_p0_launch_cohort_41_companies") continue;
      await pg.exec(await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"));
    }
    leaseDb = { $transaction: work => pg.transaction((tx: any) => work({
      $queryRawUnsafe: async <T>(sql: string, ...values: unknown[]) => (await tx.query(sql, values)).rows as T
    })) };
  }, 30000);
  afterAll(async () => { await pg?.close(); });

  async function insert(table: string, data: Record<string, unknown>) {
    const columns = Object.keys(data).map(key => `"${key}"`).join(", ");
    await pg.query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`, [JSON.stringify(data)]);
  }
  async function seededCase(work: (f: Awaited<ReturnType<typeof ownedPortableFixture>>, sql: string, commit: AtomicSourceEvidenceCommit) => Promise<void>,
    options: Parameters<typeof ownedPortableFixture>[0] = {}) {
    const f = await ownedPortableFixture(options);
    const commit = buildAtomicRuntimeCommit(f.args);
    const lease = await acquirePortableCrawlLease(leaseDb);
    try {
      const sql = await compilePortableAtomicSourceEvidenceSql(commit, lease);
      await pg.exec("BEGIN");
      const p = f.input.plan;
      await insert("Company", { id:p.company.id, officialChineseName:p.company.officialChineseName,
        officialWebsiteUrl:p.source.officialEntryUrl, pinyinName:"test", inclusionReason:"synthetic", updatedAt:new Date() });
      await insert("RecruitmentSource", { id:p.source.id, companyId:p.company.id, kind:p.source.kind,
        atsKind:p.source.atsKind, officialEntryUrl:p.source.officialEntryUrl,
        officialChainEvidenceUrl:p.source.officialChainEvidenceUrl, updatedAt:new Date() });
      await insert("ReleaseCandidate", { id:f.identity.releaseCandidateId, goalId:"synthetic", version:1,
        commitSha:f.identity.commitSha, dbSnapshotHash:"a".repeat(64), schemaHash:"a".repeat(64), migrationVersion:"local46",
        rosterHash:f.identity.rosterSha256, sourcePlanHash:f.identity.sourcePlanSha256, sourceConfigHash:f.identity.sourceConfigSha256,
        adapterBundleHash:f.identity.adapterBundleSha256, sourceTreeHash:"a".repeat(64), runtimeTreeHash:"a".repeat(64),
        oracleVersion:"synthetic", minimumStableCompanyCount:41 });
      const batch = buildPendingRuntimeBatch(f.args.batchId, [p], f.identity, f.pending.startedAt).batch;
      const batchCounts = Object.fromEntries(["transportSucceeded", "transportFailed", "adapterSucceeded", "adapterFailed",
        "completenessVerified", "completenessIncomplete", "atomicCommitted", "atomicFailed", "failedSource", "blockedSource", "skippedSource"].map(k => [k+"Count", 0]));
      await insert("CrawlBatch", { ...batch, ...batchCounts, status:"RUNNING" });
      const counts = Object.fromEntries(["raw", "parsed", "valid", "normalized", "dedupeInput", "dedupeOutput", "parseDiscard",
        "validationDiscard", "normalizationDiscard", "dedupeDiscard", "collision", "discard"].map(k => [k+"Count", 0]));
      await insert("CrawlBatchSourceResult", { ...f.pending, ...counts, releaseCandidateId:f.identity.releaseCandidateId,
        batchId:f.args.batchId, transportState:"PENDING", adapterState:"PENDING", completenessState:"PENDING", atomicCommitState:"PENDING" });
      await work(f, sql, commit);
    } finally { await pg.exec("ROLLBACK"); await releasePortableCrawlLease(leaseDb, lease); }
  }

  it("executes real typed inserts, defaults and terminal transition in one statement", async () => {
    await seededCase(async (f, sql) => {
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await pg.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("2min");
      const job = (await pg.query('SELECT * FROM "Job"')).rows[0];
      expect(job).toMatchObject({ companyId:f.input.plan.company.id, sourceId:f.input.plan.source.id,
        officialTitle:"职位1", city:"上海市", cities:["上海市"], missingSuccessCount:0,
        lifecycleStatus:"ACTIVE", visibleInFrontend:true, aiReviewRequired:false, classificationHardRuleHits:[] });
      expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
      expect((await pg.query('SELECT "setKind" FROM "LifecycleSetEvidenceMember" ORDER BY "setKind"')).rows)
        .toEqual([{setKind:"CURRENT"}, {setKind:"VISIBLE"}]);
      for (const table of ["EvidenceArtifact", "PaginationEvidence", "CrawlObservation"]) {
        expect((await pg.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBeGreaterThan(0);
      }
      expect((await pg.query('SELECT "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows)
        .toEqual([{atomicCommitState:"COMMITTED"}]);
    });
  });

  async function seedOldJob(f: Awaited<ReturnType<typeof ownedPortableFixture>>) {
    const command = buildAtomicRuntimeCommit(f.args).commands.find(command => command.type === "UPSERT_JOB")!;
    if (command.type !== "UPSERT_JOB") throw Error("Missing fixture Job");
    await insert("Job", { id:"existing-job", companyId:f.input.plan.company.id, sourceId:f.input.plan.source.id,
      dedupeKey:command.dedupeKey, officialTitle:"Old title", officialUrl:"https://example.test/old",
      auxiliaryChineseTitle:"保留辅助标题", locationRaw:"北京", city:"北京", cities:["北京"], category:"销售",
      firstSeenAt:"2025-01-01T00:00:00.000Z", lastSeenAt:"2025-01-01T00:00:00.000Z",
      humanCorrectedTitle:"保留人工标题", humanTitleCorrectionReason:"Keep title", humanTitleCorrectedAt:"2025-01-01T00:00:00.000Z",
      humanCorrectedCategory:"质量", humanCorrectionReason:"Keep", humanCorrectedAt:"2025-01-01T00:00:00.000Z", aiReviewRequired:true,
      classificationModelVersion:"retained-model", classificationHardRuleHits:["retained"] });
  }
  async function expectNoPublication() {
    for (const table of ["EvidenceArtifact", "PaginationEvidence", "LossLedgerEntry", "TransportAttemptEvidence",
      "TransportAttemptArtifact", "CrawlObservation", "LifecycleSetEvidenceMember"]) {
      expect((await pg.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n).toBe(0);
    }
    expect((await pg.query('SELECT "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows)
      .toEqual([{atomicCommitState:"PENDING"}]);
  }
  it("updates only the original Prisma Job update columns and keeps stable IDs", async () => {
    await seededCase(async (f, sql) => {
      await seedOldJob(f);
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      const job = (await pg.query('SELECT * FROM "Job"')).rows[0];
      expect(job).toMatchObject({ id:"existing-job", officialTitle:"职位1", category:"销售",
        auxiliaryChineseTitle:"保留辅助标题", humanCorrectedTitle:"保留人工标题", humanCorrectionReason:"Keep",
        aiReviewRequired:true, classificationModelVersion:"retained-model", classificationHardRuleHits:["retained"] });
      expect((await pg.query('SELECT "firstSeenAt"::text AS value FROM "Job"')).rows[0].value).toBe("2025-01-01 00:00:00");
      await pg.exec("SAVEPOINT replay");
      await expect(pg.exec(sql)).rejects.toThrow(/duplicate key/);
      await pg.exec("ROLLBACK TO SAVEPOINT replay");
      expect((await pg.query('SELECT "id" FROM "Job"')).rows).toEqual([{id:"existing-job"}]);
    });
  });
  it("rolls back every write and lease extension if the terminal update affects zero rows", async () => {
    await seededCase(async (f, sql) => {
      await seedOldJob(f);
      await pg.exec(`CREATE FUNCTION test_ignore_terminal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE TRIGGER zz_test_ignore_terminal BEFORE UPDATE ON "CrawlBatchSourceResult" FOR EACH ROW EXECUTE FUNCTION test_ignore_terminal();`);
      const before = (await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows;
      await pg.exec("SAVEPOINT publication");
      await expect(pg.exec(sql)).rejects.toThrow(/exactly one matching PENDING/);
      await pg.exec("ROLLBACK TO SAVEPOINT publication");
      await expectNoPublication();
      expect((await pg.query('SELECT "officialTitle" FROM "Job"')).rows).toEqual([{officialTitle:"Old title"}]);
      expect((await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows).toEqual(before);
    });
  });
  it.each(["expired", "replaced", "missing"])("rejects a %s database lease before any publication writes", async condition => {
    await seededCase(async (_f, sql) => {
      if (condition === "expired") await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "heartbeatAt" = clock_timestamp() - interval '301 seconds'`);
      if (condition === "replaced") await pg.exec(`UPDATE "CrawlCoordinatorLock" SET "holderId" = 'new-holder'`);
      if (condition === "missing") await pg.exec('DELETE FROM "CrawlCoordinatorLock"');
      await pg.exec("SAVEPOINT publication");
      await expect(pg.exec(sql)).rejects.toThrow(/CRAWL_LEASE_LOST/);
      await pg.exec("ROLLBACK TO SAVEPOINT publication");
      await expectNoPublication();
      expect((await pg.query('SELECT count(*)::int AS n FROM "Job"')).rows[0].n).toBe(0);
    });
  });

  it("preserves transport artifact links and SQL-special text", async () => {
    const title = "销售 O'Brien \\ ' ); DROP TABLE Job; -- $$";
    await seededCase(async (f, sql) => {
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await pg.query('SELECT "officialTitle" FROM "Job"')).rows).toEqual([{officialTitle:title}]);
      expect((await pg.query('SELECT count(*)::int AS n FROM "TransportAttemptArtifact"')).rows[0].n)
        .toBe(f.input.archive.artifacts.length);
      expect((await pg.query('SELECT "code" FROM "TransportAttemptEvidence"')).rows)
        .toEqual([{code:"HCM_BROWSER_SUCCEEDED"}]);
    }, { title, transport:true });
  });
  it("preserves loss JSON and recordedAt defaults for excluded-row diagnostic evidence", async () => {
    await seededCase(async (_f, sql) => {
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      const loss = (await pg.query('SELECT * FROM "LossLedgerEntry"')).rows;
      expect(loss).toHaveLength(1);
      expect(loss[0].stage).toBe("VALIDATION");
      expect(loss[0].details).toBeTypeOf("object");
      expect(loss[0].recordedAt).toBeDefined();
    }, { excluded:true });
  });
  it("persists rejected admission evidence without changing the last-good Job projection", async () => {
    await seededCase(async (_f, sql) => {
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await pg.query('SELECT count(*)::int AS n FROM "Job"')).rows[0].n).toBe(0);
      expect((await pg.query('SELECT count(*)::int AS n FROM "LifecycleSetEvidenceMember"')).rows[0].n).toBe(0);
      expect((await pg.query('SELECT "completenessState", "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows[0])
        .toMatchObject({completenessState:"NEEDS_MANUAL_COMPLETENESS_REVIEW", atomicCommitState:"COMMITTED"});
    }, { rejected:true });
  });
  it("rolls back Job and evidence writes on a later lifecycle exception", async () => {
    await seededCase(async (f, sql) => {
      await seedOldJob(f);
      await pg.exec(`CREATE FUNCTION test_fail_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_LIFECYCLE_FAILURE'; END $$;
        CREATE TRIGGER zz_test_fail BEFORE INSERT ON "LifecycleSetEvidenceMember" FOR EACH ROW EXECUTE FUNCTION test_fail_lifecycle();`);
      await pg.exec("SAVEPOINT publication");
      await expect(pg.exec(sql)).rejects.toThrow(/SYNTHETIC_LIFECYCLE_FAILURE/);
      await pg.exec("ROLLBACK TO SAVEPOINT publication");
      await expectNoPublication();
      expect((await pg.query('SELECT "officialTitle" FROM "Job"')).rows).toEqual([{officialTitle:"Old title"}]);
    });
  });

  it("rejects incomplete SQL bodies before any evidence, Job or lease write", async () => {
    await seededCase(async (_f, sql) => {
      const before = (await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows;
      for (const cut of [Math.floor(sql.length / 3), sql.indexOf('UPDATE public."CrawlBatchSourceResult"'), sql.lastIndexOf('$atomic_')]) {
        expect(cut).toBeGreaterThan(0);
        await pg.exec("SAVEPOINT truncated");
        await expect(pg.exec(sql.slice(0, cut))).rejects.toThrow(/unterminated dollar-quoted string/);
        await pg.exec("ROLLBACK TO SAVEPOINT truncated");
        await expectNoPublication();
        expect((await pg.query('SELECT count(*)::int AS n FROM "Job"')).rows[0].n).toBe(0);
        expect((await pg.query('SELECT "heartbeatAt" FROM "CrawlCoordinatorLock"')).rows).toEqual(before);
      }
    });
  });

  it("establishes the outer statement-timeout setting before mutation inside DO", async () => {
    await seededCase(async (_f, sql) => {
      await pg.exec(`CREATE FUNCTION test_timeout_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF current_setting('statement_timeout')::interval <> interval '120 seconds' THEN
            RAISE EXCEPTION 'STATEMENT_TIMEOUT_BOUNDARY_MISSING';
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER zz_test_timeout BEFORE INSERT ON "EvidenceArtifact" FOR EACH ROW EXECUTE FUNCTION test_timeout_boundary();`);
      // One full request, never separate setter/DO calls. PGlite 0.5.8 does not
      // enforce elapsed statement timeout in this WASM runtime; the actual MCP
      // read-only 57014 probe is the timing evidence, not this local assertion.
      await pg.exec(sql);
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      expect((await pg.query('SELECT "atomicCommitState" FROM "CrawlBatchSourceResult"')).rows)
        .toEqual([{atomicCommitState:"COMMITTED"}]);
    });
  });

  it("does not mistake a successful setter-only prefix for a committed publication", async () => {
    await seededCase(async (_f, sql) => {
      const doOffset = sql.indexOf("\nDO ");
      expect(doOffset).toBeGreaterThan(0);
      await pg.exec(sql.slice(0, doOffset));
      await expectNoPublication();
      expect((await pg.query('SELECT count(*)::int AS n FROM "Job"')).rows[0].n).toBe(0);
      // The future dispatcher must reject this shortened request by exact hash,
      // and persisted-outcome inspection must still classify this as PENDING.
    });
  });

  it("reconciles a discarded execution response by reading exact persisted state without retrying", async () => {
    await seededCase(async (_f, sql, commit) => {
      const reader: PrismaSourceResultReadDb = { crawlBatchSourceResult: {
        findUnique: async ({ where }) => {
          const rows = (await pg.query('SELECT row_to_json(r) AS row FROM "CrawlBatchSourceResult" r WHERE "id" = $1', [where.id])).rows;
          if (rows.length === 0) return null;
          const row = rows[0].row;
          // Test-only read adaptation: Prisma timestamp(3) values are UTC,
          // even when the local JS host parses timezone-less values differently.
          for (const key of ["startedAt", "finishedAt", "createdAt"]) if (row[key] !== null) row[key] = new Date(row[key] + "Z");
          return row;
        },
        findMany: async () => { throw Error("Unused fixture read"); }
      } };
      expect(await inspectPersistedAtomicCommitOutcome(commit, reader)).toEqual({state:"PENDING"});
      await pg.exec(sql); // Deliberately discard the execution result; do not retry.
      await pg.exec("SET CONSTRAINTS ALL IMMEDIATE");
      const before = (await pg.query('SELECT "id", "officialTitle" FROM "Job"')).rows;
      expect(await inspectPersistedAtomicCommitOutcome(commit, reader)).toEqual({state:"COMMITTED_EXACT"});
      const conflicting = structuredClone(commit); conflicting.sourceResult.rawCount++;
      expect(await inspectPersistedAtomicCommitOutcome(conflicting, reader)).toEqual({state:"CONFLICT"});
      const missing = structuredClone(commit); missing.sourceResult.id = "missing-result";
      expect(await inspectPersistedAtomicCommitOutcome(missing, reader)).toEqual({state:"CONFLICT"});
      expect((await pg.query('SELECT "id", "officialTitle" FROM "Job"')).rows).toEqual(before);
    });
  });

  it("rejects serialized handles and cannot mutate a live lease's identity or signal", async () => {
    const { args } = await ownedPortableFixture();
    const commit = buildAtomicRuntimeCommit(args);
    const lease = await acquirePortableCrawlLease(leaseDb);
    const holderId = lease.holderId, signal = lease.signal;
    try {
      expect(Object.isFrozen(lease)).toBe(true);
      expect(Reflect.set(lease, "holderId", "forged-holder")).toBe(false);
      expect(Reflect.set(lease, "lockId", "forged-lock")).toBe(false);
      expect(Reflect.set(lease, "signal", new AbortController().signal)).toBe(false);
      expect(lease.holderId).toBe(holderId); expect(lease.signal).toBe(signal);
      const serialized = JSON.parse(JSON.stringify(lease));
      await expect(compilePortableAtomicSourceEvidenceSql(commit, serialized)).rejects.toThrow(/CRAWL_LEASE_NOT_OWNED/);
      const compiling = expect(compilePortableAtomicSourceEvidenceSql(commit, lease)).rejects.toThrow(/CRAWL_LEASE_LOST/);
      await releasePortableCrawlLease(leaseDb, lease);
      await compiling;
      await expect(compilePortableAtomicSourceEvidenceSql(commit, lease)).rejects.toThrow(/CRAWL_LEASE_LOST/);
    } finally { await releasePortableCrawlLease(leaseDb, lease); }
  });

  it("requires live attestation and an owned lease before returning any SQL", async () => {
    const { args } = await ownedPortableFixture();
    const commit = buildAtomicRuntimeCommit(args);
    const lease = await acquirePortableCrawlLease(leaseDb);
    try {
      await expect(compilePortableAtomicSourceEvidenceSql(structuredClone(commit), lease)).rejects.toThrow(/ATTESTATION_MISSING/);
      await expect(compilePortableAtomicSourceEvidenceSql(commit, { ...lease })).rejects.toThrow(/NOT_OWNED/);
      const sql = await compilePortableAtomicSourceEvidenceSql(commit, lease);
      expect(sql).toMatch(/^SET LOCAL statement_timeout = '120000ms';\nDO /);
      expect(sql).toContain("set_config('lock_timeout', '120000ms', true)");
      expect(sql).toContain('FOR UPDATE');
      expect(sql.indexOf('FOR UPDATE')).toBeLessThan(sql.indexOf('clock_timestamp()'));
      expect(sql).toContain('GET DIAGNOSTICS');
      commit.sourceResult.rawCount++;
      await expect(compilePortableAtomicSourceEvidenceSql(commit, lease)).rejects.toThrow(/ATTESTATION_INVALID/);
    } finally { await releasePortableCrawlLease(leaseDb, lease); }
  });
});
