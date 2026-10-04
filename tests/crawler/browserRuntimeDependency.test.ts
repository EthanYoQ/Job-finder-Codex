import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractProductionImageStage, PRODUCTION_BROWSER_DEB_SHA256, PRODUCTION_BROWSER_DEB_URL,
  PRODUCTION_RUNTIME_APT_COMMAND } from "../../src/readiness/productionImageContract";

describe("browser-backed crawler runtime dependencies", () => {
  it("explicitly enables sandboxing at every production Chromium launch without override", () => {
    const launchFiles: string[] = [];
    const unsafeLaunches: string[] = [];
    for (const file of readdirSync("src", { recursive: true, encoding: "utf8" })) {
      if (!/\.tsx?$/u.test(file)) continue;
      const path = join("src", file);
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "chromium" &&
            node.expression.name.text === "launch") {
          launchFiles.push(path.replaceAll("\\", "/"));
          const options = node.arguments[0];
          const properties = options && ts.isObjectLiteralExpression(options) ? options.properties : [];
          const sandboxIndex = properties.findIndex((property) => ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) && property.name.text === "chromiumSandbox" &&
            property.initializer.kind === ts.SyntaxKind.TrueKeyword);
          // Later spreads or computed keys could silently replace the safety option.
          const canOverride = properties.slice(sandboxIndex + 1).some((property) =>
            ts.isSpreadAssignment(property) || property.name &&
              (ts.isComputedPropertyName(property.name) || property.name.getText(source) === "chromiumSandbox" ||
                ts.isStringLiteral(property.name) && property.name.text === "chromiumSandbox"));
          if (sandboxIndex < 0 || canOverride) unsafeLaunches.push(path);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(launchFiles.sort()).toEqual([
      "src/crawler/jnjCareersChinaSourceFetch.ts",
      "src/crawler/officialJsonRenderedTraversalValidator.ts",
      "src/crawler/officialJsonSourceFetch.ts",
      "src/crawler/planBoundHtmlTraversalValidator.ts",
      "src/crawler/qiluRenderedTraversalValidator.ts",
      "src/crawler/traversalCertificate.ts",
      "src/readiness/formalBrowserPreflight.ts"
    ]);
    expect(unsafeLaunches).toEqual([]);
  });

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
    const runtimeStage = extractProductionImageStage(dockerfile, "runtime");
    expect(runtimeStage).toContain(PRODUCTION_RUNTIME_APT_COMMAND);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_URL);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_SHA256);
    expect(readFileSync("scripts/browser-runtime-smoke.mjs", "utf8")).toContain("inspectFormalBrowserRuntime");
    const runtime = readFileSync("src/crawler/officialJsonSourceFetch.ts", "utf8");
    expect(runtime).toContain("executablePath: FORMAL_CHROMIUM_PATH");
    expect(runtime).toContain("args:[...FORMAL_CHROMIUM_ARGS]");
    expect(runtime).not.toMatch(/P0_CHROMIUM_PATH|P0_CHROME_CHANNEL/u);
    expect(dockerfile).toMatch(/USER\s+(?!root\b)\S+/u);
    expect(runtimeStage).not.toContain("chown -R node:node /app");
    expect(runtimeStage).toContain("install -d -m 0700 -o node -g node /app/outputs");
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
    const runtimeStage = extractProductionImageStage(dockerfile, "runtime");

    expect(runtimeStage).toBeDefined();
    expect(runtimeStage).toMatch(/^ENV HOME=\/tmp$/mu);
    expect(runtimeStage).toMatch(/^ENV XDG_CONFIG_HOME=\/tmp\/\.config$/mu);
    expect(runtimeStage).toMatch(/^ENV XDG_CACHE_HOME=\/tmp\/\.cache$/mu);
    expect(dockerfile).not.toContain("--no-sandbox");
  });
});
