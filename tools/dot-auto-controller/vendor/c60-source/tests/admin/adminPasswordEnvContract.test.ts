import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hashAdminPassword, verifyAdminPassword } from "../../src/admin/auth";

describe("admin password environment contract", () => {
  it("documents a structurally valid value for the password hash algorithm supported by runtime", async () => {
    const envExample = readFileSync(".env.example", "utf8");
    const match = envExample.match(/^ADMIN_PASSWORD_HASH=(['"])(.*?)\1$/mu);

    expect(match, "ADMIN_PASSWORD_HASH should be present in .env.example").not.toBeNull();
    expect(envExample).not.toMatch(/argon2/iu);
    expect(match?.[1], "single quotes must protect literal $ characters from Compose interpolation").toBe("'");

    const exampleHash = match?.[2];

    if (exampleHash === undefined) {
      throw new Error("ADMIN_PASSWORD_HASH is missing from .env.example");
    }

    const runtimeHash = await hashAdminPassword("contract-probe", "contract-salt");
    const [runtimeAlgorithm, , runtimeDigest] = runtimeHash.split("$");
    const [exampleAlgorithm, exampleSalt, exampleDigest] = exampleHash.split("$");

    expect(exampleAlgorithm).toBe(runtimeAlgorithm);
    expect(exampleSalt).toBeTruthy();
    expect(exampleDigest).toMatch(/^[a-f0-9]+$/u);
    expect(exampleDigest).toHaveLength(runtimeDigest!.length);
    await expect(verifyAdminPassword("not-a-default-password", exampleHash)).resolves.toBe(false);
  });
});
