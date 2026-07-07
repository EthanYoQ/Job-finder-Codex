import { describe, expect, it } from "vitest";
import { execFileSync, execSync } from "node:child_process";
const databaseUrl = "postgresql://job_finder:job_finder@localhost:5432/job_finder?schema=public";
const commandOptions = { encoding: "utf8", env: { ...process.env, DATABASE_URL: databaseUrl } } as const;

describe("prisma schema", () => {
  it("validates the PostgreSQL data model", () => {
    const output =
      process.platform === "win32"
        ? execSync("npm run --silent prisma:validate", { ...commandOptions, shell: true })
        : execFileSync("npm", ["run", "--silent", "prisma:validate"], commandOptions);

    expect(output).toMatch(/is valid/i);
  });
});
