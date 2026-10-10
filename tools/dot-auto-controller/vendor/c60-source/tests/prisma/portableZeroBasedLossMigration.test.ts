import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) => readFileSync(resolve(process.cwd(), "prisma/migrations", name, "migration.sql"), "utf8");
const priorName = "20261001151000_portable_loss_position_identity";
const nextName = "20261001163000_portable_zero_based_loss_pages";

describe("append-only zero-based loss page migration", () => {
  it("preserves the applied SQL38 bytes", () => {
    expect(createHash("sha256").update(readMigration(priorName)).digest("hex"))
      .toBe("6d8d551d9725348aef46c95ebcae876c82fcd77186495c73f9e8a7c29c2bcbba");
  });

  it("changes only the present pageSequence integer regex in the complete trigger", () => {
    const prior = readMigration(priorName);
    const next = readMigration(nextName);
    const functionSql = (sql: string) => sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"), sql.indexOf("\nCOMMIT;"));
    const positive = `COALESCE(loss."details"->>'pageSequence','') !~ '^[1-9][0-9]*$'`;
    const nonnegative = `COALESCE(loss."details"->>'pageSequence','') !~ '^(0|[1-9][0-9]*)$'`;
    expect(functionSql(prior).split(positive)).toHaveLength(2);
    expect(functionSql(next)).toBe(functionSql(prior).replace(positive, () => nonnegative));
  });

  it("guards the exact SQL38 function before replacing it, in a bounded transaction", () => {
    const sql = readMigration(nextName);
    expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
    expect(sql).toContain("IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> '76339115623dd07ecc6261da3b4523a6' THEN");
    expect(sql.indexOf("$guard$;")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(sql.trimEnd()).toMatch(/COMMIT;$/);
  });
});
