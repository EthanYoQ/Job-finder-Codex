export const PRODUCTION_NODE_IMAGE_REPOSITORY = "node:22-bookworm-slim" as const;
export const PRODUCTION_NODE_IMAGE_DIGEST =
  "sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436" as const;
export const PRODUCTION_NODE_IMAGE_REF =
  `${PRODUCTION_NODE_IMAGE_REPOSITORY}@${PRODUCTION_NODE_IMAGE_DIGEST}` as const;
export const PRODUCTION_RUNTIME_IMAGE_REF = PRODUCTION_NODE_IMAGE_REF;
export const PRODUCTION_RUNTIME_APT_PACKAGES = [
  "ca-certificates", "libpq5", "libreadline8", "util-linux"
] as const;
export const PRODUCTION_BROWSER_MIN_ENGINE_VERSION = "151.0.7922.137" as const;
export const PRODUCTION_BROWSER_RELEASE = "v1.93.136" as const;
export const PRODUCTION_BROWSER_DEB_NAME = "brave-browser_1.93.136_amd64.deb" as const;
export const PRODUCTION_BROWSER_DEB_URL =
  "https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb" as const;
export const PRODUCTION_BROWSER_DEB_SHA256 =
  "9739e5aaee4303eb4199c038b04a75d7bc7ac08314af9f763011e211dea62999" as const;
export const PRODUCTION_BROWSER_KEYRING_VERSION = "1.20" as const;
export const PRODUCTION_BROWSER_KEYRING_DEB_NAME = "brave-keyring_1.20-1.deb" as const;
export const PRODUCTION_BROWSER_KEYRING_DEB_URL =
  "https://brave-browser-apt-release.s3.brave.com/pool/main/b/brave-keyring/brave-keyring_1.20-1.deb" as const;
export const PRODUCTION_BROWSER_KEYRING_DEB_SHA256 =
  "9ea8725ad4241e4d30bc31b0d5213c7ce24b1dcd5247875b2de1bcba8c4e9b00" as const;
export const PRODUCTION_RUNTIME_APT_COMMAND =
  `sh /usr/local/bin/install-apt-packages.sh ${PRODUCTION_RUNTIME_APT_PACKAGES.join(" ")}` as const;

export function extractProductionNodeStage(dockerfile: string, stage: "deps" | "production-deps" | "runtime"): string {
  const marker = `FROM ${stage === "runtime" ? PRODUCTION_RUNTIME_IMAGE_REF : PRODUCTION_NODE_IMAGE_REF} AS ${stage}`;
  const start = dockerfile.indexOf(marker);
  if (start < 0) throw new Error(`Production image is missing pinned ${stage} stage`);
  const bodyStart = start + marker.length;
  const nextStage = dockerfile.indexOf("\nFROM ", bodyStart);
  return dockerfile.slice(bodyStart, nextStage < 0 ? undefined : nextStage);
}

export function compareDottedVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  if (leftParts.some((part) => !Number.isSafeInteger(part) || part < 0) ||
      rightParts.some((part) => !Number.isSafeInteger(part) || part < 0)) {
    throw new Error("Browser engine version is invalid");
  }
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
