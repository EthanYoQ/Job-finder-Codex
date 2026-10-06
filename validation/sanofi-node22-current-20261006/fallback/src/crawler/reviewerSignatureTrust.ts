import { verifyProvenanceEnvelopeCore, type ProvenanceVerificationContext,
  type SignedProvenanceEnvelope } from "./reviewerSignatureCore";
export { canonicalSignedProvenancePayload, signedProvenancePayloadSha256 } from "./reviewerSignatureCore";
export type { ProvenancePurpose, ProvenanceVerificationContext, SignedProvenanceEnvelope,
  SignedProvenancePayload } from "./reviewerSignatureCore";

const productionRegistry = Object.freeze({ schemaVersion: 1 as const, keys: Object.freeze([{
  keyId: "p0-independent-reviewer-prod-2026-01",
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEARl23ye7IxK/o81D+XuayPzbMsa29Qqs6gDBva646kRA=
-----END PUBLIC KEY-----`
}]) });

export function verifyProductionProvenanceSignature(envelope: SignedProvenanceEnvelope,
  context: ProvenanceVerificationContext): void {
  const key = productionRegistry.keys.find((entry) => entry.keyId === envelope.keyId.trim().normalize("NFC"));
  if (!key) throw new Error("Reviewer signing key is not in the trusted committed production registry");
  verifyProvenanceEnvelopeCore(envelope, context, key);
}
