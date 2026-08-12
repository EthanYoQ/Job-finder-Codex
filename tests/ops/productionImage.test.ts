import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
      /FROM node:22-bookworm-slim@sha256:[a-f0-9]{64} AS deps[\s\S]*install-apt-packages\.sh openssl[\s\S]*npx prisma generate/u
    );
    expect(dockerfile).toMatch(/npm ci --omit=dev/u);
    expect(dockerfile).toMatch(
      /FROM build AS identity[\s\S]*RUN rm -rf \/app\/node_modules\s*COPY --from=production-deps \/app\/node_modules \.\/node_modules[\s\S]*generate-build-identity/u
    );
    expect(dockerfile).not.toContain("FROM production-deps AS identity");
    expect(dockerfile).toContain("COPY --from=identity /app/node_modules ./node_modules");
    expect(dockerfile).not.toContain("COPY . .");
    expect(packageJson.dependencies?.tsx).toBeDefined();
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
  });
});
