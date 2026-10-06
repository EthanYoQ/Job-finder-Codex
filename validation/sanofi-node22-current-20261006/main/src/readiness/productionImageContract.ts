export const PRODUCTION_NODE_IMAGE_REPOSITORY = "node:22-trixie-slim" as const;
export const PRODUCTION_NODE_IMAGE_DIGEST =
  "sha256:f4c1b09232a0ae8f765093968ec82107a1be65cb0bfb36fc831195794f139568" as const;
export const PRODUCTION_NODE_IMAGE_REF =
  `${PRODUCTION_NODE_IMAGE_REPOSITORY}@${PRODUCTION_NODE_IMAGE_DIGEST}` as const;
export const PRODUCTION_RUNTIME_IMAGE_REPOSITORY = "ubuntu:26.04" as const;
export const PRODUCTION_RUNTIME_IMAGE_DIGEST =
  "sha256:678c6550cc43645e08669028bc177f50be4e7c5b8cca677067b1914d4afc7a03" as const;
export const PRODUCTION_RUNTIME_IMAGE_REF =
  `${PRODUCTION_RUNTIME_IMAGE_REPOSITORY}@${PRODUCTION_RUNTIME_IMAGE_DIGEST}` as const;
export const PRODUCTION_RUNTIME_OS_FAMILY = "ubuntu" as const;
export const PRODUCTION_RUNTIME_OS_NAME = "26.04" as const;
export const PRODUCTION_RUNTIME_APT_PACKAGES = [
  "ca-certificates", "libpq5", "libreadline8t64", "openssl", "util-linux"
] as const;
export const PRODUCTION_BROWSER_MIN_ENGINE_VERSION = "151.0.7922.137" as const;
export const PRODUCTION_BROWSER_ENGINE_REALPATH = "/opt/brave.com/brave/brave" as const;
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

export function extractProductionImageStage(dockerfile: string, stage: "deps" | "production-deps" | "runtime"): string {
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
