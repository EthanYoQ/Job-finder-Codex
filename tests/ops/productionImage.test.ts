import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractProductionNodeStage, PRODUCTION_NODE_IMAGE_REF } from "../../src/readiness/productionImageContract";

const read = (path: string) => readFileSync(path, "utf8");

describe("production container contract", () => {
  it("builds generated artifacts explicitly and installs only runtime dependencies", () => {
    const dockerfile = read("Dockerfile");
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(dockerfile).toContain("npx prisma generate");
    expect(dockerfile).toMatch(
      new RegExp(`FROM ${PRODUCTION_NODE_IMAGE_REF} AS deps[\\s\\S]*install-apt-packages\\.sh openssl[\\s\\S]*npx prisma generate`, "u")
    );
    expect(dockerfile).toMatch(/npm ci --omit=dev/u);
    expect(dockerfile).toMatch(
      /FROM build AS identity[\s\S]*RUN rm -rf \/app\/node_modules\s*COPY --from=production-deps \/app\/node_modules \.\/node_modules[\s\S]*generate-build-identity/u
    );
    expect(dockerfile).not.toContain("FROM production-deps AS identity");
    expect(dockerfile).toContain("COPY --from=identity /app/node_modules ./node_modules");
    const runtimeStage = extractProductionNodeStage(dockerfile, "runtime");
    expect(runtimeStage).not.toContain("package-lock.json");
    expect(dockerfile).not.toContain("COPY . .");
    expect(packageJson.dependencies?.tsx).toBeDefined();
    expect(packageJson.dependencies?.prisma).toBeDefined();
    expect(packageJson.devDependencies?.tsx).toBeUndefined();
    for (const buildOnly of ["@tavily/core", "lucide-react", "react", "react-dom"]) {
      expect(packageJson.dependencies?.[buildOnly]).toBeUndefined();
      expect(packageJson.devDependencies?.[buildOnly]).toBeDefined();
    }
  });

  it("uses an allowlisted context, non-root runtime, liveness probe, and size guard", () => {
    const dockerfile = read("Dockerfile");
    const dockerignore = read(".dockerignore");
    const packageJson = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    const contextCheck = read("scripts/check-production-image-context.mjs");

    expect(dockerignore.trimStart()).toMatch(/^\*\*/u);
    for (const excluded of [".git", "node_modules", "tests", "outputs", ".scratch", "*.db"]) {
      expect(dockerignore).not.toContain(`!${excluded}`);
    }
    expect(dockerfile).toMatch(/^USER node$/mu);
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/livez");
    expect(packageJson.scripts?.["image:context-check"]).toBe(
      "node scripts/check-production-image-context.mjs"
    );
    expect(packageJson.scripts?.["image:runtime-contract-check"]).toBe(
      "tsx scripts/check-production-runtime-contract.ts"
    );
    expect(contextCheck).toContain('".docker-build-provenance.bundle"');
    expect(contextCheck).toContain("MAX_PROVENANCE_BUNDLE_BYTES");
  });

  it("provides a repeatable clean Linux build and startup smoke workflow", () => {
    const workflow = read(".github/workflows/production-image.yml");

    expect(workflow).toContain("npm run image:context-check");
    expect(workflow).toContain("npm run image:runtime-contract-check");
    expect(workflow).toContain("npm run docker:export-provenance");
    expect(workflow).toMatch(/docker build[\s\S]*--no-cache/u);
    expect(workflow).toContain("BUILD_COMMIT_SHA=${{ github.sha }}");
    expect(workflow).toContain("BUILD_SOURCE_CLEAN=true");
    expect(workflow).toContain("BUILD_SOURCE_TREE_SHA256");
    expect(workflow).toContain("docker run");
    expect(workflow).toContain("/livez");
    expect(workflow).toContain(".Config.User");
    expect(workflow).toContain('IMAGE_USER="$(docker image inspect');
    expect(workflow).toContain('IMAGE_REVISION="$(docker image inspect');
    expect(workflow).toContain('printf \'runtime_user=%s\\nrevision=%s\\nimage_bytes=%s\\nmax_image_bytes=%s\\n\'');
    expect(workflow).toContain(
      `'{{index .Config.Labels "org.opencontainers.image.revision"}}'`
    );
    expect(workflow).not.toContain("docker run --detach --rm");
    expect(workflow).toContain("MAX_IMAGE_BYTES");
    expect(workflow).toContain("MAX_IMAGE_BYTES: 1600000000");
    expect(workflow).toContain("aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25");
    expect(workflow).toContain("npm audit --omit=dev --json");
    expect(workflow).toContain("npm run security:production-gate");
    expect(workflow).toContain("--image-digest \"$IMAGE_DIGEST\"");
    expect(workflow).toContain("production-security-receipt.json");
    expect(workflow).toContain("scripts/bind-npm-audit-report.ts");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toMatch(/name: Preserve production security evidence\s+if: always\(\)/u);
  });
});
