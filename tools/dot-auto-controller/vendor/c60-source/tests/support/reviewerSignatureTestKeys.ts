import { generateKeyPairSync } from "node:crypto";

export function createReviewerTestKeyPair() {
  return generateKeyPairSync("ed25519");
}
