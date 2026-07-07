import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");
const databaseUrl = "postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public";

describe("prisma schema", () => {
  it("validates the PostgreSQL data model", () => {
    const output = execFileSync(
      process.execPath,
      [prismaCli, "validate", "--schema", "prisma/schema.prisma"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl } }
    );

    expect(output).toContain("The schema at prisma\\schema.prisma is valid");
  });
});
