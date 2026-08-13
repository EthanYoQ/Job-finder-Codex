import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  extractProductionNodeStage,
  PRODUCTION_BROWSER_DEB_SHA256,
  PRODUCTION_BROWSER_DEB_NAME,
  PRODUCTION_BROWSER_DEB_URL,
  PRODUCTION_BROWSER_KEYRING_DEB_NAME,
  PRODUCTION_BROWSER_KEYRING_DEB_SHA256,
  PRODUCTION_BROWSER_KEYRING_DEB_URL,
  PRODUCTION_BROWSER_KEYRING_VERSION,
  PRODUCTION_BROWSER_RELEASE,
  PRODUCTION_NODE_IMAGE_REF
} from "../../src/readiness/productionImageContract";

const read = (path: string) => readFileSync(path, "utf8");

describe("production container contract", () => {
  it("builds generated artifacts explicitly and installs only runtime dependencies", () => {
    const dockerfile = read("Dockerfile");
    const workflow = read(".github/workflows/production-image.yml");
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
    expect(dockerfile).toContain("COPY --chown=node:node --from=identity /app/node_modules ./node_modules");
    const runtimeStage = extractProductionNodeStage(dockerfile, "runtime");
    expect(runtimeStage).not.toContain("package-lock.json");
    expect(runtimeStage).not.toMatch(/npm install --global/u);
    expect(runtimeStage).toContain("rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx");
    expect(runtimeStage).toContain('CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server/httpServer.ts"]');
    expect(runtimeStage).not.toContain("chown -R node:node /app");
    expect(runtimeStage).toContain("COPY --chown=node:node --from=identity /app/node_modules ./node_modules");
    expect(runtimeStage).toContain("install -d -m 0700 -o node -g node /app/outputs");
    const identityCopies = runtimeStage.match(/^COPY --chown=node:node --from=identity .+$/gmu) ?? [];
    expect(identityCopies).toHaveLength(13);
    expect(runtimeStage.match(/^COPY (?!--chown=node:node )[^\n]*--from=identity .+$/gmu)).toBeNull();
    expect(workflow).toContain("test ! -e /usr/local/lib/node_modules/npm && ! command -v npm && ! command -v npx");
    expect(workflow).toContain("scripts/runtime-exposure-probe.mjs > .runtime/security/runtime-exposure-raw.json");
    expect(workflow).toContain("scripts/bind-runtime-exposure-report.ts");
    expect(runtimeStage).toContain(`ADD --checksum=sha256:${PRODUCTION_BROWSER_DEB_SHA256}`);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_URL);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_DEB_NAME);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_NAME);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_URL);
    expect(runtimeStage).toContain(PRODUCTION_BROWSER_KEYRING_DEB_SHA256);
    expect(runtimeStage).toContain("/tmp/brave-keyring.deb /tmp/brave-browser.deb");
    expect(runtimeStage).toContain(`test "$(dpkg-query -W -f='\${Version}' brave-keyring)" = "${PRODUCTION_BROWSER_KEYRING_VERSION}"`);
    expect(runtimeStage).toContain("test ! -e /etc/apt/sources.list.d/brave-browser-release.list");
    expect(runtimeStage).toContain("test ! -e /usr/share/keyrings/brave-browser-archive-keyring.gpg");
    expect(runtimeStage).toContain("apt-get purge -y wget");
    expect(runtimeStage).toContain("apt-get check");
    expect(runtimeStage).toContain("! dpkg-query -W wget >/dev/null 2>&1");
    expect(runtimeStage).toContain("! command -v wget");
    expect(runtimeStage).toContain("ln -s /usr/bin/brave-browser-stable /usr/bin/chromium");
    expect(runtimeStage).not.toContain("PRODUCTION_CHROMIUM_MIN_VERSION");
    expect(runtimeStage).toContain(
      'test "$(dpkg-query -W -f=\'${Version}\' brave-browser)" = "1.93.136"'
    );
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
    expect(workflow).toContain(".draft == false");
    expect(workflow).toContain(".prerelease == false");
    expect(workflow).toContain("Authorization: Bearer ${{ github.token }}");
    expect(workflow).toContain("brave-browser_1.93.136_amd64.deb");
    expect(workflow).toContain("--read-only --cap-drop ALL --security-opt no-new-privileges:true");
    expect(workflow).toContain("--tmpfs /tmp:rw,nosuid,nodev,noexec");
    expect(workflow).toContain("BUILD_SOURCE_CLEAN=true");
    expect(workflow).toContain("BUILD_SOURCE_TREE_SHA256");
    expect(workflow).toContain("docker run");
    expect(workflow).toContain("docker build --platform linux/amd64");
    expect(workflow).toContain("scripts/browser-runtime-smoke.mjs");
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
    expect(workflow).toContain("packages: write");
    expect(workflow.match(/packages: write/gu)).toHaveLength(1);
    expect(workflow).toContain("publish-qualified-image:");
    expect(workflow).toContain("needs: clean-build-and-smoke");
    expect(workflow).toContain("Publish and bind the qualified image manifest");
    expect(workflow).toContain("REMOTE_CONFIG_DIGEST");
    expect(workflow).toContain('test "$REMOTE_CONFIG_DIGEST" = "$LOCAL_CONFIG_DIGEST"');
    expect(workflow).toContain("scripts/write-deployment-image-receipt.ts");
    expect(workflow.indexOf("Publish and bind the qualified image manifest"))
      .toBeGreaterThan(workflow.indexOf("Publish exact-image qualification receipt"));
    expect(workflow).toContain("scripts/bind-npm-audit-report.ts");
    expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    expect(workflow).toMatch(/name: Preserve production security evidence\s+if: always\(\)/u);
    const record = workflow.indexOf("mkdir -p .runtime\n          printf '%s\\n' \"$IMAGE_BYTES\" > .runtime/image-bytes.txt");
    const decomposition = workflow.indexOf("name: Capture exact image size decomposition");
    const upload = workflow.indexOf("name: Preserve production security evidence");
    const sizeGate = workflow.indexOf("name: Enforce recorded production image size");
    const qualification = workflow.indexOf("name: Start in a blank Linux container and probe liveness");
    expect(record).toBeGreaterThan(0);
    expect(decomposition).toBeGreaterThan(record);
    expect(workflow.slice(decomposition, upload)).toContain("image-history.jsonl");
    expect(workflow.slice(decomposition, upload)).toContain("image-directory-bytes.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-package-kib.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-package-dpkg-raw.txt");
    expect(workflow.slice(decomposition, upload)).toContain("image-size-identity.txt");
    expect(workflow.slice(decomposition, upload)).toContain('IMAGE_DIGEST="$(docker image inspect');
    expect(workflow.slice(decomposition, upload)).toContain("docker history --no-trunc --human=false");
    expect(workflow.slice(decomposition, upload)).toContain("--network none --user 0 --read-only --cap-drop ALL");
    expect(workflow.slice(decomposition, upload)).toContain("--cap-add DAC_READ_SEARCH");
    expect(workflow.slice(decomposition, upload)).toContain("--entrypoint dpkg-query");
    expect(workflow.slice(decomposition, upload)).toContain("'--showformat=${db:Status-Abbrev}\\t${Installed-Size}\\t${binary:Package}\\t${Version}\\n'");
    expect(workflow.slice(decomposition, upload)).toContain("awk -F '\\t' '$1 == \"ii \"");
    expect(workflow.slice(decomposition, upload)).toContain('size=($2 == "" ? "UNKNOWN" : $2)');
    expect(workflow.slice(decomposition, upload)).toContain("END { if (count == 0) exit 1 }");
    expect(upload).toBeGreaterThan(record);
    expect(upload).toBeGreaterThan(decomposition);
    expect(sizeGate).toBeGreaterThan(upload);
    expect(qualification).toBeGreaterThan(sizeGate);
    expect(workflow.slice(sizeGate, qualification)).toContain("if: always()");
    expect(workflow.slice(sizeGate, qualification)).toContain('test "$IMAGE_BYTES" -le "$MAX_IMAGE_BYTES"');
  });

  it("keeps the declarative browser asset consumers bound to the single TypeScript contract", () => {
    const dockerfile = read("Dockerfile");
    const workflow = read(".github/workflows/production-image.yml");
    for (const consumer of [dockerfile, workflow]) {
      expect(consumer).toContain(PRODUCTION_BROWSER_RELEASE);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_NAME);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_URL);
      expect(consumer).toContain(PRODUCTION_BROWSER_DEB_SHA256);
    }
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_NAME);
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_URL);
    expect(dockerfile).toContain(PRODUCTION_BROWSER_KEYRING_DEB_SHA256);
  });

  it("rejects drift in every pinned Node runtime stage", () => {
    const dockerfile = read("Dockerfile");
    for (const stage of ["deps", "production-deps", "runtime"] as const) {
      expect(extractProductionNodeStage(dockerfile, stage)).toBeTruthy();
      expect(() => extractProductionNodeStage(
        dockerfile.replace(`FROM ${PRODUCTION_NODE_IMAGE_REF} AS ${stage}`, `FROM node:22-bookworm-slim AS ${stage}`),
        stage
      )).toThrow(/pinned/u);
    }
  });
});
