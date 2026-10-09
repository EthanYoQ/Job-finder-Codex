import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { CLOUD_PILOT_SQL45 } from "../../src/db/cloudPilotSql45Manifest";

export const INCREMENTAL_MIGRATION = "20261006172300_job_projection_delta_contract";
export const INCREMENTAL_PGLITE_LIMITATIONS = [
  "In-process PostgreSQL-WASM only; no socket, server, multi-session concurrency, production data, or deployment was used.",
  "TEST-ONLY pgcrypto packaging adapter: digest(bytea,'sha256') delegates to PostgreSQL core sha256; native pgcrypto installation and extension relocation are not exercised.",
  "The original 48 migration source guards and delta migration execute; the historical 60-to-41 company cleanup uses synthetic seeded companies."
] as const;

export interface IncrementalPgliteDatabase {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

/** Creates only an ephemeral memory instance. Explicit consent to the test adapter
 * is mandatory, so a caller cannot accidentally label this native pgcrypto QA. */
export async function createIncrementalPglite(options: {
  modulePath: string;
  allowTestHashShim: true;
  producerRoot?: string;
  includeDelta?: boolean;
}): Promise<{ pg: IncrementalPgliteDatabase; limitations: typeof INCREMENTAL_PGLITE_LIMITATIONS;
  appliedMigrations: Array<{ migrationName: string; checksum: string }>; cryptoMode: "TEST_ONLY_CORE_SHA256_ADAPTER" }> {
  if (options.allowTestHashShim !== true) throw Error("INCREMENTAL_PGLITE_TEST_HASH_ADAPTER_ACK_REQUIRED");
  const producerRoot = options.producerRoot ?? process.cwd();
  const { PGlite } = createRequire(import.meta.url)(resolve(options.modulePath).replace(/\.js$/u, ".cjs"));
  const pg: IncrementalPgliteDatabase = new PGlite();
  const appliedMigrations: Array<{ migrationName: string; checksum: string }> = [];
  try {
    const adapter = `CREATE FUNCTION public.digest(data bytea, algorithm text) RETURNS bytea
      LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $test_adapter$
      BEGIN
        IF algorithm IS DISTINCT FROM 'sha256' THEN RAISE EXCEPTION 'TEST_HASH_ADAPTER_SHA256_ONLY'; END IF;
        RETURN pg_catalog.sha256(data);
      END; $test_adapter$;`;
    for (const historical of CLOUD_PILOT_SQL45.migrations) {
      let sql = await readFile(resolve(producerRoot, "prisma/migrations", historical.migrationName, "migration.sql"), "utf8");
      const actualHash = createHash("sha256").update(sql).digest("hex");
      if (actualHash !== historical.checksum) throw Error(`INCREMENTAL_TEST_HISTORY_CHECKSUM_DRIFT:${historical.migrationName}`);
      // Only extension packaging is adapted. No check, trigger, or source gate is removed.
      if (historical.migrationName === "20260711220000_lifecycle_set_cryptographic_closure") {
        const line = "CREATE EXTENSION IF NOT EXISTS pgcrypto;";
        if (sql.split(line).length !== 2) throw Error("INCREMENTAL_TEST_PGCRYPTO_INSTALL_SHAPE");
        sql = sql.replace(line, adapter);
      }
      if (historical.migrationName === "20260711240000_lifecycle_trigger_security_closure") {
        const line = "ALTER EXTENSION pgcrypto SET SCHEMA extensions;";
        if (sql.split(line).length !== 2) throw Error("INCREMENTAL_TEST_PGCRYPTO_RELOCATION_SHAPE");
        sql = sql.replace(line, "ALTER FUNCTION public.digest(bytea,text) SET SCHEMA extensions;");
      }
      const cohort = historical.migrationName === "20260927120000_p0_launch_cohort_41_companies";
      if (cohort) {
        const retired = [...new Set([...sql.matchAll(/'company-([a-z0-9-]+)'/gu)].map(match => `company-${match[1]}`))];
        if (retired.length !== 19) throw Error("INCREMENTAL_TEST_COHORT_INPUT_DRIFT");
        for (const id of [...retired, ...Array.from({ length: 41 }, (_, index) => `incremental-test-cohort-${index}`)]) {
          await pg.query('INSERT INTO public."Company" (id,"officialChineseName","officialWebsiteUrl","pinyinName","inclusionReason","updatedAt") VALUES($1,$1,$2,$1,$3,CURRENT_TIMESTAMP)',
            [id, "https://example.test/synthetic", "In-memory migration fixture only"]);
        }
      }
      await pg.exec(sql);
      if (cohort) await pg.exec('DELETE FROM public."Company" WHERE id LIKE \'incremental-test-cohort-%\'');
      appliedMigrations.push({ ...historical });
    }
    if (options.includeDelta !== false) {
      const sql = await readFile(resolve(producerRoot, "prisma/migrations", INCREMENTAL_MIGRATION, "migration.sql"), "utf8");
      await pg.exec(sql);
      appliedMigrations.push({ migrationName: INCREMENTAL_MIGRATION, checksum: createHash("sha256").update(sql).digest("hex") });
    }
    await pg.exec('CREATE TABLE public."_prisma_migrations" (id text,migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz)');
    for (const item of appliedMigrations) await pg.query('INSERT INTO public."_prisma_migrations" VALUES($1,$1,$2,clock_timestamp(),NULL)', [item.migrationName, item.checksum]);
    return { pg, appliedMigrations, limitations: INCREMENTAL_PGLITE_LIMITATIONS, cryptoMode: "TEST_ONLY_CORE_SHA256_ADAPTER" };
  } catch (error) { await pg.close(); throw error; }
}
