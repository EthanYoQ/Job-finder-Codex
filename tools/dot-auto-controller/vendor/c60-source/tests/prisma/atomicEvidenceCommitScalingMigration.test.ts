import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  "prisma/migrations/20260715090000_atomic_evidence_commit_scaling/migration.sql"
);

describe("atomic evidence commit scaling migration", () => {
  it("keeps per-job lifecycle validation without repeating the whole-source projection for every member", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const memberValidator = sql.match(
      /CREATE OR REPLACE FUNCTION public\.validate_lifecycle_set_member_projection\(\)[\s\S]+?END \$\$;/
    )?.[0];

    expect(memberValidator).toBeDefined();
    expect(memberValidator).toContain("invalid lifecycle set member cross-set projection");
    expect(memberValidator).toContain('m."jobKey" = NEW."jobKey"');
    expect(memberValidator).not.toContain("assert_verified_parent_lifecycle_projection");
    expect(sql).not.toMatch(/DROP\s+(FUNCTION|TRIGGER)/i);
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.validate_lifecycle_set_member_projection() FROM PUBLIC"
    );
  });
});
