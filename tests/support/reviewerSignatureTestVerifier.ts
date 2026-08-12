import type { KeyObject } from "node:crypto";
import { verifyProvenanceEnvelopeCore, type ProvenanceVerificationContext,
  type SignedProvenanceEnvelope } from "../../src/crawler/reviewerSignatureCore";

export function verifyWithExplicitTestReviewer(envelope: SignedProvenanceEnvelope,
  context: ProvenanceVerificationContext, publicKey: KeyObject): void {
  verifyProvenanceEnvelopeCore(envelope, context, Object.freeze({ keyId: "p0-independent-reviewer-test-2026-01",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }));
}
