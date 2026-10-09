import { createHash, createPublicKey, verify } from "node:crypto";

export type ProvenancePurpose = "REVIEW" | "HOP_CHAIN";
export interface SignedProvenancePayload { schemaVersion: 1; purpose: ProvenancePurpose;
  reviewerIdentitySha256: string; producerIdentitySha256: string; provenanceRootSha256: string;
  authoritativeMembershipDigest: string; oracleMemberSetSha256: string }
export interface SignedProvenanceEnvelope { keyId: string; payload: SignedProvenancePayload; signatureBase64: string }
export interface ProvenanceVerificationContext { runtimeCommitSha: string; adapterBundleSha256: string;
  runtimeFetchProducerIdentitySha256?: string }
export interface ReviewerPublicKeyRecord { keyId: string; publicKeyPem: string }

export function canonicalSignedProvenancePayload(payload: SignedProvenancePayload): Buffer {
  if (payload.schemaVersion !== 1 || !["REVIEW", "HOP_CHAIN"].includes(payload.purpose)) throw new Error("Unsupported signed provenance payload schema");
  const values = [String(payload.schemaVersion), payload.purpose, payload.reviewerIdentitySha256,
    payload.producerIdentitySha256, payload.provenanceRootSha256,
    payload.authoritativeMembershipDigest, payload.oracleMemberSetSha256].map(normalize);
  for (const value of values.slice(2)) if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Signed provenance payload identity/hash is not canonical SHA-256");
  const chunks = values.map((value) => Buffer.from(value, "utf8")); const count = u32(chunks.length);
  return Buffer.concat([count, ...chunks.map((chunk) => Buffer.concat([u32(chunk.length), chunk]))]);
}
export function signedProvenancePayloadSha256(payload: SignedProvenancePayload): string {
  return createHash("sha256").update(canonicalSignedProvenancePayload(payload)).digest("hex");
}
export function verifyProvenanceEnvelopeCore(envelope: SignedProvenanceEnvelope,
  context: ProvenanceVerificationContext, key: ReviewerPublicKeyRecord): void {
  if (normalize(envelope.keyId) !== key.keyId) throw new Error("Reviewer signing key is not trusted");
  assertIndependentIdentities(envelope.payload, context);
  const signature = Buffer.from(envelope.signatureBase64, "base64");
  if (signature.length !== 64 || !verify(null, canonicalSignedProvenancePayload(envelope.payload),
    createPublicKey(key.publicKeyPem), signature)) throw new Error("Reviewer provenance signature is invalid");
}
function assertIndependentIdentities(payload: SignedProvenancePayload, context: ProvenanceVerificationContext): void {
  const reviewer = normalizeSha(payload.reviewerIdentitySha256, "reviewer identity");
  const producer = normalizeSha(payload.producerIdentitySha256, "producer identity");
  const forbidden = new Set([reviewer, normalizeSha(context.adapterBundleSha256, "adapter bundle"),
    createHash("sha256").update(normalize(context.runtimeCommitSha), "utf8").digest("hex"),
    normalize(context.runtimeCommitSha).padStart(64, "0")]);
  if (context.runtimeFetchProducerIdentitySha256) forbidden.add(normalizeSha(context.runtimeFetchProducerIdentitySha256, "runtime fetch producer identity"));
  if (forbidden.has(producer)) throw new Error("Reviewer/producer/runtime identity independence violation");
}
function normalizeSha(value: string, label: string): string { const result = normalize(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} is not canonical SHA-256`); return result; }
function normalize(value: string): string { if (typeof value !== "string") throw new Error("Canonical provenance value must be a string");
  const result = value.trim().normalize("NFC"); if (!result) throw new Error("Canonical provenance value is blank"); return result; }
function u32(value: number): Buffer { const out = Buffer.allocUnsafe(4); out.writeUInt32BE(value); return out; }
