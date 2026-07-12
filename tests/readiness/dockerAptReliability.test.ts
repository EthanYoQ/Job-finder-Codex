import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Docker apt transport reliability", () => {
  it("uses bounded retries and timeouts for every apt update and install layer", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    const retryOptions = "-o Acquire::Retries=5 -o Acquire::http::Timeout=30";
    const updateCommands = dockerfile.match(/apt-get[^\n]* update/gmu) ?? [];
    const installCommands = dockerfile.match(/apt-get[^\n]* install/gmu) ?? [];

    expect(updateCommands).toHaveLength(3);
    expect(installCommands).toHaveLength(3);
    for (const command of [...updateCommands, ...installCommands]) {
      expect(command).toContain(retryOptions);
    }
    expect(dockerfile).not.toContain("Acquire::https::Verify-Peer=false");
  });
});
