import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
const databaseUrl = "postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public";

describe("prisma schema", () => {
  it("validates the PostgreSQL data model", () => {
    const output = execSync("npm run --silent prisma:validate", {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });

    expect(output).toMatch(/is valid/i);
  });
});
