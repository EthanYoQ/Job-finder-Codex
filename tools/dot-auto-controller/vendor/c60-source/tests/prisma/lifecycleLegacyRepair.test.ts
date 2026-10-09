import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy lifecycle data repair", () => {
  it("repairs only the hidden OFFLINE count-two state without reactivating jobs", () => {
    const sql = readFileSync(resolve(
      process.cwd(),
      "prisma/migrations/20260714053000_repair_legacy_offline_count_two/migration.sql"
    ), "utf8");

    expect(sql).toMatch(/UPDATE\s+"Job"/u);
    expect(sql).toMatch(/SET\s+"lifecycleStatus"\s*=\s*'SUSPECTED_OFFLINE'/u);
    expect(sql).toMatch(/"lifecycleStatus"\s*=\s*'OFFLINE'/u);
    expect(sql).toMatch(/"missingSuccessCount"\s*=\s*2/u);
    expect(sql).not.toMatch(/'ACTIVE'|DELETE\s+FROM|TRUNCATE/u);
  });
});
