import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("production dependency security", () => {
  it("pins the patched deepmerge-ts release used by Prisma config", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      overrides?: Record<string, Record<string, string>>;
    };
    const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      packages: Record<string, { dependencies?: Record<string, string>; version?: string }>;
    };

    expect(packageJson.overrides?.["@prisma/config"]?.["deepmerge-ts"]).toBe("8.0.0");
    expect(
      packageLock.packages["node_modules/@prisma/config"]?.dependencies?.["deepmerge-ts"]
    ).toBe("7.1.5");
    expect(packageLock.packages["node_modules/deepmerge-ts"]?.version).toBe("8.0.0");
  });
});
