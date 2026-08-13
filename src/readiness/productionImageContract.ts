export const PRODUCTION_NODE_IMAGE_REPOSITORY = "node:22-bookworm-slim" as const;
export const PRODUCTION_NODE_IMAGE_DIGEST =
  "sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436" as const;
export const PRODUCTION_NODE_IMAGE_REF =
  `${PRODUCTION_NODE_IMAGE_REPOSITORY}@${PRODUCTION_NODE_IMAGE_DIGEST}` as const;
export const PRODUCTION_RUNTIME_APT_PACKAGES = [
  "ca-certificates", "chromium", "libpq5", "libreadline8", "util-linux"
] as const;
export const PRODUCTION_CHROMIUM_MIN_VERSION = "151.0.7922.137-1~deb12u1" as const;
export const PRODUCTION_RUNTIME_APT_COMMAND =
  `sh /usr/local/bin/install-apt-packages.sh ${PRODUCTION_RUNTIME_APT_PACKAGES.join(" ")}` as const;

export function extractProductionNodeStage(dockerfile: string, stage: "deps" | "production-deps" | "runtime"): string {
  const marker = `FROM ${PRODUCTION_NODE_IMAGE_REF} AS ${stage}`;
  const start = dockerfile.indexOf(marker);
  if (start < 0) throw new Error(`Production image is missing pinned ${stage} stage`);
  const bodyStart = start + marker.length;
  const nextStage = dockerfile.indexOf("\nFROM ", bodyStart);
  return dockerfile.slice(bodyStart, nextStage < 0 ? undefined : nextStage);
}
