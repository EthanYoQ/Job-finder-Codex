import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("browser-backed crawler runtime dependencies", () => {
  it("declares playwright-core as a production dependency", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.["playwright-core"]).toMatch(/^\d+\.\d+\.\d+$/u);
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.packages["node_modules/playwright-core"].version).toBe(packageJson.dependencies?.["playwright-core"]);
  });

  it("installs a production browser and exposes the fixed-path smoke command for a later no-network container run", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("chromium");
    expect(readFileSync("scripts/browser-runtime-smoke.mjs", "utf8")).toContain('"/usr/bin/chromium"');
    const runtime = readFileSync("src/crawler/officialJsonSourceFetch.ts", "utf8");
    expect(runtime).toContain("executablePath: FORMAL_CHROMIUM_PATH");
    expect(runtime).toContain("args:[...FORMAL_CHROMIUM_ARGS]");
    expect(runtime).not.toMatch(/P0_CHROMIUM_PATH|P0_CHROME_CHANNEL/u);
    expect(dockerfile).toMatch(/USER\s+(?!root\b)\S+/u);
    expect(dockerfile).toMatch(/RUN [^\n]*chown -R node:node \/app[\s\S]*USER node/u);
    expect(readFileSync("scripts/browser-runtime-smoke.mjs", "utf8")).not.toContain("--no-sandbox");
    expect(readFileSync("src/readiness/formalBrowserPreflight.ts", "utf8")).not.toContain("--no-sandbox");
    expect(runtime).not.toContain("--no-sandbox");
  });

  it("keeps every attested root in the runtime image",()=>{
    const dockerfile=readFileSync("Dockerfile","utf8");
    expect(dockerfile).toContain("/app/Dockerfile");
    expect(dockerfile).toContain("/app/.dockerignore");
  });

  it("binds browser state directories to the writable tmpfs used by the hardened runtime", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const runtimeStage = dockerfile.split(/^FROM node:22-bookworm-slim AS runtime$/mu)[1];

    expect(runtimeStage).toBeDefined();
    expect(runtimeStage).toMatch(/^ENV HOME=\/tmp$/mu);
    expect(runtimeStage).toMatch(/^ENV XDG_CONFIG_HOME=\/tmp\/\.config$/mu);
    expect(runtimeStage).toMatch(/^ENV XDG_CACHE_HOME=\/tmp\/\.cache$/mu);
    expect(dockerfile).not.toContain("--no-sandbox");
  });
});
