import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("runtime OCI image labels", () => {
  it("binds the runtime image labels to the verified commit and source tree", () => {
    const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
    const runtime = dockerfile.slice(dockerfile.indexOf(" AS runtime"));

    expect(runtime).toMatch(/^ARG BUILD_COMMIT_SHA$/mu);
    expect(runtime).toMatch(/^ARG BUILD_SOURCE_TREE_SHA256$/mu);
    expect(runtime).toMatch(
      /^LABEL org\.opencontainers\.image\.title="Job Finder" \\\r?\n\s+org\.opencontainers\.image\.revision="\$\{BUILD_COMMIT_SHA\}" \\\r?\n\s+io\.jobfinder\.source-tree-sha256="\$\{BUILD_SOURCE_TREE_SHA256\}"$/mu
    );
  });
});
