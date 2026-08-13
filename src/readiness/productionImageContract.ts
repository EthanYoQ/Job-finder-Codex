export const PRODUCTION_NODE_IMAGE_REPOSITORY = "node:22-trixie-slim" as const;
export const PRODUCTION_NODE_IMAGE_DIGEST =
  "sha256:db8a96a63e5264607ada2d206758876ebbed6a12be2ada7517793cbfb0c2a29c" as const;
export const PRODUCTION_NODE_IMAGE_REF =
  `${PRODUCTION_NODE_IMAGE_REPOSITORY}@${PRODUCTION_NODE_IMAGE_DIGEST}` as const;

export function extractProductionNodeStage(dockerfile: string, stage: "deps" | "production-deps" | "runtime"): string {
  const marker = `FROM ${PRODUCTION_NODE_IMAGE_REF} AS ${stage}`;
  const start = dockerfile.indexOf(marker);
  if (start < 0) throw new Error(`Production image is missing pinned ${stage} stage`);
  const bodyStart = start + marker.length;
  const nextStage = dockerfile.indexOf("\nFROM ", bodyStart);
  return dockerfile.slice(bodyStart, nextStage < 0 ? undefined : nextStage);
}
