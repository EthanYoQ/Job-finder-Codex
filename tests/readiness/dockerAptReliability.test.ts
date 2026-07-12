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

  it("retries each complete apt transaction at most three times and fails closed", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    const aptRunLayers = dockerfile
      .split(/(?=^RUN )/mu)
      .filter((section) => section.startsWith("RUN ") && section.includes("apt-get"));

    expect(aptRunLayers).toHaveLength(3);
    for (const layer of aptRunLayers) {
      expect(layer).toContain("for attempt in 1 2 3; do");
      expect(layer).toMatch(/if apt-get[^\n]* update \\\n\s+&& apt-get[^\n]* install[^\n]*; then/u);
      expect(layer).toContain('if [ "$attempt" -eq 3 ]; then');
      expect(layer).toMatch(/\n\s+exit 1; \\\n\s+fi;/u);
      expect(layer).toContain("sleep 2;");
      expect(layer).toContain("done");
      expect(layer).not.toMatch(/while\s+true|\|\|\s*true|--fix-missing|--allow-unauthenticated/u);
    }
  });
});
