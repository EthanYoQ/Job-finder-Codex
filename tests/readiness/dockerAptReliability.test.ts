import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("Docker apt transport reliability",()=>{
  it("uses one bounded installer with locked download and index caches in every apt layer",()=>{
    const dockerfile=read("Dockerfile");
    const layers=dockerfile.match(
      /^RUN --mount=type=cache,target=\/var\/cache\/apt,sharing=locked \\\r?\n\s+--mount=type=cache,target=\/var\/lib\/apt,sharing=locked \\\r?\n\s+sh \/usr\/local\/bin\/install-apt-packages\.sh [^\r\n]+$/gmu,
    )??[];

    expect(layers).toHaveLength(3);
    for(const layer of layers){
      expect(layer).toContain("--mount=type=cache,target=/var/cache/apt,sharing=locked");
      expect(layer).toContain("--mount=type=cache,target=/var/lib/apt,sharing=locked");
      expect(layer).toMatch(/sh \/usr\/local\/bin\/install-apt-packages\.sh [^\n]+/u);
    }
    expect(dockerfile).not.toMatch(/apt-get[^\n]*(?:update|install)/u);
  });

  it("keeps release-specific build arguments after reusable system dependency layers",()=>{
    const dockerfile=read("Dockerfile");
    const buildStage=dockerfile.split(/^FROM deps AS build$/mu)[1]!.split(/^FROM .* AS runtime$/mu)[0]!;
    const runtimeStage=dockerfile.split(/^FROM .* AS runtime$/mu)[1]!;

    for(const stage of [buildStage,runtimeStage]){
      const aptRunIndex=stage.indexOf("sh /usr/local/bin/install-apt-packages.sh");
      expect(aptRunIndex).toBeGreaterThan(-1);
      expect(stage.indexOf("ARG BUILD_COMMIT_SHA")).toBeGreaterThan(aptRunIndex);
      expect(stage.indexOf("ARG BUILD_SOURCE_TREE_SHA256")).toBeGreaterThan(aptRunIndex);
    }
  });

  it("separates update and install retries, preserves downloads, and fails within fifteen minutes",()=>{
    const dockerfile=read("Dockerfile");
    const installer=read("ops/install-apt-packages.sh");
    const updateIndex=installer.indexOf("update --error-on=any");
    const installIndex=installer.indexOf("install -y --no-install-recommends");

    expect(installer).toContain('APT_TOTAL_TIMEOUT_SECONDS="${APT_TOTAL_TIMEOUT_SECONDS:-900}"');
    expect(installer).toContain('timeout --signal=TERM --kill-after=10s "${APT_TOTAL_TIMEOUT_SECONDS}s"');
    expect(installer).toContain("Acquire::Retries=2");
    expect(installer).toContain("Acquire::http::Timeout=30");
    expect(installer).toContain("Acquire::https::Timeout=30");
    expect(installer).toContain("update --error-on=any");
    expect(installer).toContain("DEBIAN_FRONTEND=noninteractive");
    expect(installer).toContain("install -y --no-install-recommends");
    expect(installer).toContain('rm -f "$APT_CONFIG_DIR/docker-clean"');
    expect(installer).toContain('Binary::apt::APT::Keep-Downloaded-Packages "true";');
    expect(installer.match(/for attempt in 1 2 3; do/gmu)).toHaveLength(2);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(updateIndex);
    expect(installer.slice(updateIndex,installIndex)).toContain("done");
    expect(installer).not.toMatch(/while\s+true|\|\|\s*true/u);
    expect(`${dockerfile}\n${installer}`).not.toMatch(
      /--fix-missing|--force-yes|--allow-unauthenticated|--allow-insecure-repositories|--allow-downgrades-to-insecure-repositories|Acquire::https::Verify-(?:Peer|Host)\s*=\s*false/iu,
    );
  });
});
