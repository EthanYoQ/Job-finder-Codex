import { EventEmitter } from "node:events";
import { Client } from "pg";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createPgPreflightClient,
  assertExistingDatabaseMigrationHistory,
  assertExistingDatabaseMigrationManifest,
  preflightExistingDatabase
} from "../../src/db/existingDatabasePreflight";
import { listCurrentPrismaMigrations, prismaMigrationManifestSha256 } from "../../src/db/prismaMigrationManifest";

const RECOVERED = [
  { migrationName: "20260927110000_crawl_coordinator_table_lock", checksum: "5b8c19c744abe771124f4f0a9e7f985e34693ab05dc7a50da87d77b2bb69ca0c" },
  { migrationName: "20260927120000_p0_launch_cohort_41_companies", checksum: "17b71a51cb5fd63575e7f04ac9f51fe9af72c85d70dd8badb5430ed259606c4d" }
];
const EXPECTED = [
  ...listCurrentPrismaMigrations(process.cwd()).filter((entry) => entry.migrationName <= "20260927120000_p0_launch_cohort_41_companies" && !RECOVERED.some((recovered) => recovered.migrationName === entry.migrationName)),
  ...RECOVERED
];
const MANIFEST_SHA256 = "7c4f0d64fe40c63a9ce3837b71f3bfb0454e70f8f4763d4fe3e2f73e7d909e51";
const rows = EXPECTED.map(({ migrationName, checksum }) => ({
  migration_name: migrationName, checksum, finished_at: new Date("2026-09-27T12:30:00Z"), rolled_back_at: null
}));
const options = { databaseUrl: "postgresql://user:secret@db/jobfinder?schema=public", expectedMigrations: EXPECTED };

function client() {
  return Object.assign(new EventEmitter(), { connect: vi.fn(async () => undefined), query: vi.fn(async () => ({ rows })), end: vi.fn(async () => undefined), destroy: vi.fn() });
}

describe("existing-database-only migration alignment", () => {
  it("recovers the exact applied bytes and pins the full 36-migration manifest", () => {
    const actual = listCurrentPrismaMigrations(process.cwd()).filter(entry=>entry.migrationName <= "20260927120000_p0_launch_cohort_41_companies");
    expect(actual).toHaveLength(36);
    expect(actual.slice(-2)).toEqual(RECOVERED);
    expect(prismaMigrationManifestSha256(actual)).toBe(MANIFEST_SHA256);
    expect(() => assertExistingDatabaseMigrationManifest(actual)).not.toThrow();
  });

  it("accepts only the separately reviewed 37-migration portable history after it is applied",async()=>{
    const expected=listCurrentPrismaMigrations(process.cwd()).filter(entry=>entry.migrationName<="20261001120000_portable_source_quality_policy");
    expect(expected).toHaveLength(37);
    expect(prismaMigrationManifestSha256(expected)).toBe("e8fe3d551610925cfba8fc17b21eaa60eb2fd937061b188ceb1657c1324828db");
    expect(()=>assertExistingDatabaseMigrationManifest(expected)).not.toThrow();
    const applied=expected.map(({migrationName,checksum})=>({migration_name:migrationName,checksum,finished_at:new Date(),rolled_back_at:null}));
    expect(()=>assertExistingDatabaseMigrationHistory(applied,expected)).not.toThrow();
    expect(()=>assertExistingDatabaseMigrationHistory(applied.slice(0,-1),expected)).toThrow();
    expect(()=>assertExistingDatabaseMigrationHistory(applied.map((r,i)=>i===36?{...r,checksum:"0".repeat(64)}:r),expected)).toThrow();
    expect(()=>assertExistingDatabaseMigrationHistory([...applied,{...applied[0]!,migration_name:"99999999999999_unknown"}],expected)).toThrow();
    const db=client();db.query.mockResolvedValue({rows:applied});
    await expect(preflightExistingDatabase({...options,expectedMigrations:expected,createClient:()=>db})).resolves.toEqual({mode:"existing-database-only",migrationCount:37,migrationManifestSha256:"e8fe3d551610925cfba8fc17b21eaa60eb2fd937061b188ceb1657c1324828db"});
  });

  it("accepts the exact reviewed 38 history and rejects missing, drifted, unfinished or unknown additions",async()=>{
    const expected=listCurrentPrismaMigrations(process.cwd()).filter(entry=>entry.migrationName<="20261001151000_portable_loss_position_identity");
    expect(expected).toHaveLength(38);
    const hash="aefdc6c8c6b1dcf506dbda2673aeed1b9eb47068e760a6b3dd66e245793144da";
    expect(prismaMigrationManifestSha256(expected)).toBe(hash);
    const applied=expected.map(({migrationName,checksum})=>({migration_name:migrationName,checksum,finished_at:new Date(),rolled_back_at:null}));
    expect(()=>assertExistingDatabaseMigrationHistory(applied,expected)).not.toThrow();
    for(const invalid of [applied.slice(0,-1),applied.map((r,i)=>i===37?{...r,checksum:"0".repeat(64)}:r),
      applied.map((r,i)=>i===37?{...r,finished_at:null}:r),[...applied,{...applied[0]!,migration_name:"99999999999999_unknown"}]])
      expect(()=>assertExistingDatabaseMigrationHistory(invalid,expected)).toThrow();
    const db=client();db.query.mockResolvedValue({rows:applied});
    await expect(preflightExistingDatabase({...options,expectedMigrations:expected,createClient:()=>db})).resolves.toEqual({mode:"existing-database-only",migrationCount:38,migrationManifestSha256:hash});
  });

  it("accepts the exact reviewed 39 history and rejects missing 38/39, drifted, unfinished, rolled-back or unknown history", async () => {
    const expected = listCurrentPrismaMigrations(process.cwd()).filter(entry=>entry.migrationName<="20261001163000_portable_zero_based_loss_pages");
    expect(expected).toHaveLength(39);
    const hash = "1ed8337df77374882330faf922cbc21d52e591a8450895f45571192800c9d907";
    expect(prismaMigrationManifestSha256(expected)).toBe(hash);
    expect(() => assertExistingDatabaseMigrationManifest(expected)).not.toThrow();
    const applied = expected.map(({ migrationName, checksum }) => ({
      migration_name: migrationName, checksum, finished_at: new Date(), rolled_back_at: null
    }));
    expect(() => assertExistingDatabaseMigrationHistory(applied, expected)).not.toThrow();
    for (const index of [37, 38]) {
      for (const invalid of [
        applied.filter((_row, i) => i !== index),
        applied.map((row, i) => i === index ? { ...row, checksum: "0".repeat(64) } : row),
        applied.map((row, i) => i === index ? { ...row, finished_at: null } : row),
        applied.map((row, i) => i === index ? { ...row, rolled_back_at: new Date() } : row)
      ]) expect(() => assertExistingDatabaseMigrationHistory(invalid, expected)).toThrow(/existing-database-only/i);
    }
    for (const invalid of [
      [...applied, applied[38]!],
      [...applied, { ...applied[38]!, migration_name: "99999999999999_unknown" }]
    ]) expect(() => assertExistingDatabaseMigrationHistory(invalid, expected)).toThrow(/existing-database-only/i);
    const db = client(); db.query.mockResolvedValue({ rows: applied });
    await expect(preflightExistingDatabase({ ...options, expectedMigrations: expected, createClient: () => db }))
      .resolves.toEqual({ mode: "existing-database-only", migrationCount: 39, migrationManifestSha256: hash });
    for (const expectedMigrations of [
      expected.map((row, i) => i === 38 ? { ...row, checksum: "0".repeat(64) } : row),
      [...expected, { migrationName: "99999999999999_unknown", checksum: "0".repeat(64) }]
    ]) {
      const createClient = vi.fn(client);
      await expect(preflightExistingDatabase({ ...options, expectedMigrations, createClient })).rejects.toThrow(/existing-database-only/i);
      expect(createClient).not.toHaveBeenCalled();
    }
  });

  it("accepts only the complete exact successful history, irrespective of input order", () => {
    expect(() => assertExistingDatabaseMigrationHistory([...rows].reverse(), EXPECTED)).not.toThrow();
  });

  it.each([
    ["fresh database", []],
    ["both recovery migrations missing", rows.slice(0, -2)],
    ["lock migration missing", rows.filter((row) => row.migration_name !== RECOVERED[0]!.migrationName)],
    ["cohort migration missing", rows.slice(0, -1)],
    ["old migration missing", rows.slice(1)],
    ["extra successful migration", [...rows, { ...rows[0]!, migration_name: "99999999999999_extra" }]],
    ["duplicate successful migration", [...rows, rows[0]!]],
    ["unfinished cohort migration", rows.map((row, index) => index === 35 ? { ...row, finished_at: null } : row)],
    ["rolled-back cohort migration", rows.map((row, index) => index === 35 ? { ...row, rolled_back_at: new Date() } : row)],
    ["historical rolled-back attempt", [...rows, { ...rows[0]!, finished_at: null, rolled_back_at: new Date() }]],
    ["wrong recovery checksum", rows.map((row, index) => index === 35 ? { ...row, checksum: "0".repeat(64) } : row)],
    ["wrong old checksum", rows.map((row, index) => index === 0 ? { ...row, checksum: "0".repeat(64) } : row)]
  ])("rejects %s without filtering away any history", (_name, history) => {
    expect(() => assertExistingDatabaseMigrationHistory(history, EXPECTED)).toThrow(/existing-database-only/i);
  });

  it.each([
    ["missing artifacts", EXPECTED.slice(0, -2)],
    ["added artifacts", [...EXPECTED, { migrationName: "99999999999999_extra", checksum: "f".repeat(64) }]],
    ["recovery artifact drift", EXPECTED.map((entry, index) => index === 35 ? { ...entry, checksum: "0".repeat(64) } : entry)],
    ["prior artifact drift", EXPECTED.map((entry, index) => index === 0 ? { ...entry, checksum: "0".repeat(64) } : entry)]
  ])("rejects local %s before connecting", async (_name, expectedMigrations) => {
    const createClient = vi.fn(client);
    await expect(preflightExistingDatabase({ ...options, expectedMigrations, createClient })).rejects.toThrow(/existing-database-only/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses a bounded read-only transaction and queries only migration history", async () => {
    const db = client();
    const createClient = vi.fn(() => db);
    await expect(preflightExistingDatabase({ ...options, createClient })).resolves.toEqual({
      mode: "existing-database-only", migrationCount: 36, migrationManifestSha256: MANIFEST_SHA256
    });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 2500,
      query_timeout: 2500, statement_timeout: 2500
    }));
    expect(db.query.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([
      "BEGIN READ ONLY",
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name COLLATE "C", id COLLATE "C"',
      "ROLLBACK"
    ]);
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each(["connect", "query", "end"] as const)("fails closed and does not leak %s errors", async (stage) => {
    const db = client();
    db[stage].mockRejectedValue(new Error(`driver error: ${options.databaseUrl}`));
    const error = await preflightExistingDatabase({ ...options, createClient: () => db }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/existing-database-only/i);
    expect(String(error)).not.toContain("secret");
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, false, 0, ""])("fails closed even when a driver rejects with a non-Error value (%s)", async (reason) => {
    const db = client();
    db.query.mockRejectedValue(reason);
    await expect(preflightExistingDatabase({ ...options, createClient: () => db })).rejects.toThrow(/existing-database-only/i);
  });

  it("treats an absent migration table as a refusal and closes the connection", async () => {
    const db = client();
    db.query.mockRejectedValue(new Error('relation "_prisma_migrations" does not exist'));
    await expect(preflightExistingDatabase({ ...options, createClient: () => db })).rejects.toThrow(/existing-database-only/i);
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each(["connect", "query", "end"] as const)("fails closed if %s hangs", async (stage) => {
    const db = client();
    db[stage].mockImplementation(() => new Promise<never>(() => {}));
    await expect(preflightExistingDatabase({ ...options, timeoutMs: 10, createClient: () => db })).rejects.toThrow(/existing-database-only/i);
    expect(db.end).toHaveBeenCalledOnce();
  });

  it.each(["connect", "query", "end"] as const)("sanitizes real pg error events during %s and closes the client", async (stage) => {
    const db = Object.assign(new Client({ connectionString: options.databaseUrl }), { destroy: vi.fn() });
    let escaped: unknown;
    const emitError = () => {
      try { db.emit("error", new Error(`socket failure ${options.databaseUrl}`)); }
      catch (error) { escaped = error; }
    };
    vi.spyOn(db, "connect").mockImplementation((async () => {
      if (stage === "connect") { queueMicrotask(emitError); return new Promise<never>(() => {}); }
    }) as never);
    vi.spyOn(db, "query").mockImplementation((async () => {
      if (stage === "query") { queueMicrotask(emitError); return new Promise<never>(() => {}); }
      return { rows };
    }) as never);
    const end = vi.spyOn(db, "end").mockImplementation((async () => {
      if (stage === "end") queueMicrotask(emitError);
    }) as never);
    const error = await preflightExistingDatabase({ ...options, timeoutMs: 30, createClient: () => db })
      .catch((reason: unknown) => reason);
    expect(escaped).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/existing-database-only/i);
    expect(String(error)).not.toContain("secret");
    expect(end).toHaveBeenCalledOnce();
    expect(() => db.emit("error", new Error(`late failure ${options.databaseUrl}`))).not.toThrow();
  });

  it("absorbs late pg socket errors after successful cleanup without an unhandled event", async () => {
    const db = client();
    await expect(preflightExistingDatabase({ ...options, createClient: () => db })).resolves.toMatchObject({ migrationCount: 36 });
    expect(() => db.emit("error", new Error(`late failure ${options.databaseUrl}`))).not.toThrow();
  });

  it("keeps an error listener after cleanup times out and prevents late queries", async () => {
    const db = client();
    let releaseConnect!: () => void;
    db.connect.mockImplementation(() => new Promise<undefined>((resolve) => { releaseConnect = () => resolve(undefined); }));
    db.end.mockImplementation(() => new Promise<never>(() => {}));
    await expect(preflightExistingDatabase({ ...options, timeoutMs: 10, createClient: () => db })).rejects.toThrow(/existing-database-only/i);
    expect(() => db.emit("error", new Error(`late failure ${options.databaseUrl}`))).not.toThrow();
    releaseConnect();
    await Promise.resolve();
    expect(db.query).not.toHaveBeenCalled();
    expect(db.end).toHaveBeenCalledOnce();
  });

  it("force-closes its owned pg transport when idle cleanup never finishes", async () => {
    const transport = new PassThrough();
    const db = createPgPreflightClient({ stream: () => transport });
    const connect = vi.spyOn(Client.prototype, "connect").mockImplementation((async () => undefined) as never);
    const query = vi.spyOn(Client.prototype, "query").mockImplementation((async () => ({ rows })) as never);
    const end = vi.spyOn(Client.prototype, "end").mockImplementation((() => new Promise<never>(() => {})) as never);
    try {
      expect(transport.destroyed).toBe(false);
      await expect(preflightExistingDatabase({ ...options, timeoutMs: 10, createClient: () => db }))
        .rejects.toThrow(/existing-database-only/i);
      expect(transport.destroyed).toBe(true);
      expect(end).toHaveBeenCalledOnce();
    } finally {
      connect.mockRestore(); query.mockRestore(); end.mockRestore(); transport.destroy();
    }
  });

  it.each(["", "not-a-url", "postgresql://user:secret@db/jobfinder?schema=other", "postgresql://user:secret@db/jobfinder?options=-c%20default_transaction_read_only=off"])("rejects unsafe connection configuration before connecting", async (databaseUrl) => {
    const createClient = vi.fn(client);
    await expect(preflightExistingDatabase({ ...options, databaseUrl, createClient })).rejects.toThrow(/existing-database-only/i);
    expect(createClient).not.toHaveBeenCalled();
  });
});
