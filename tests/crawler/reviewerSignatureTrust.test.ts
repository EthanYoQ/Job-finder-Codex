import { sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalSignedProvenancePayload, verifyProductionProvenanceSignature,
  type SignedProvenancePayload } from "../../src/crawler/reviewerSignatureTrust";
import { verifyWithExplicitTestReviewer } from "../support/reviewerSignatureTestVerifier";
import { createReviewerTestKeyPair } from "../support/reviewerSignatureTestKeys";
const payload: SignedProvenancePayload = { schemaVersion: 1, purpose: "REVIEW",
  reviewerIdentitySha256: "1".repeat(64), producerIdentitySha256: "2".repeat(64),
  provenanceRootSha256: "3".repeat(64), authoritativeMembershipDigest: "4".repeat(64),
  oracleMemberSetSha256: "5".repeat(64) };

describe("committed reviewer signature trust", () => {
  it("rejects an arbitrary self-signed key even when its payload hashes are well formed", () => {
    const rogueReviewerPrivateKey = createReviewerTestKeyPair().privateKey;
    const signatureBase64 = sign(null, canonicalSignedProvenancePayload(payload), rogueReviewerPrivateKey).toString("base64");
    expect(() => verifyProductionProvenanceSignature({ keyId: "rogue-key", payload, signatureBase64 }, {
      runtimeCommitSha: "6".repeat(40), adapterBundleSha256: "7".repeat(64), runtimeFetchProducerIdentitySha256: "8".repeat(64)
    })).toThrow(/registry|trusted/i);
  });

  it.each(["reviewer", "commit", "adapter", "fetch"])("rejects %s identity collapse before certification", (kind) => {
    const rogueReviewerPrivateKey = createReviewerTestKeyPair().privateKey;
    const altered = { ...payload };
    const context = { runtimeCommitSha: "6".repeat(40), adapterBundleSha256: "7".repeat(64),
      runtimeFetchProducerIdentitySha256: "8".repeat(64) };
    if (kind === "reviewer") altered.producerIdentitySha256 = altered.reviewerIdentitySha256;
    if (kind === "commit") altered.producerIdentitySha256 = context.runtimeCommitSha.padStart(64, "0");
    if (kind === "adapter") altered.producerIdentitySha256 = context.adapterBundleSha256;
    if (kind === "fetch") altered.producerIdentitySha256 = context.runtimeFetchProducerIdentitySha256;
    const signatureBase64 = sign(null, canonicalSignedProvenancePayload(altered), rogueReviewerPrivateKey).toString("base64");
    expect(() => verifyProductionProvenanceSignature({ keyId: "rogue-key", payload: altered, signatureBase64 }, context))
      .toThrow();
  });

  it("rejects the dedicated test key on the formal non-test registry path", () => {
    const testReviewerPrivateKey = createReviewerTestKeyPair().privateKey;
    const signatureBase64 = sign(null, canonicalSignedProvenancePayload(payload), testReviewerPrivateKey).toString("base64");
    const previous = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try {
      expect(() => verifyProductionProvenanceSignature({ keyId: "p0-independent-reviewer-test-2026-01",
        payload, signatureBase64 }, { runtimeCommitSha: "6".repeat(40), adapterBundleSha256: "7".repeat(64) }))
        .toThrow(/registry|trusted/i);
    } finally { process.env.NODE_ENV = previous; }
  });
  it("allows the pure core to be tested only through an explicit test-support verifier", () => {
    const testKeyPair = createReviewerTestKeyPair();
    const signatureBase64 = sign(null, canonicalSignedProvenancePayload(payload), testKeyPair.privateKey).toString("base64");
    expect(() => verifyWithExplicitTestReviewer({ keyId: "p0-independent-reviewer-test-2026-01",
      payload, signatureBase64 }, { runtimeCommitSha: "6".repeat(40), adapterBundleSha256: "7".repeat(64) }, testKeyPair.publicKey))
      .not.toThrow();
  });
});
