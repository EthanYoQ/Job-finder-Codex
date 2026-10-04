import { z } from "zod";
/** Source configuration, never a job/title/URL lookup. Included in the reviewed plan hash. */
export const ASTELLAS_PDF_CITY_CONFIG = Object.freeze({
  policy: "ASTELLAS_OWNED_PDF_CITIES_V1" as const,
  extractor: "ASTELLAS_PDF_LOCATION_V1" as const,
  maxDocuments: 64, maxRetainedBytes: 32 * 1024 * 1024, parserAddressSpaceBytes: 256 * 1024 * 1024,
  concurrency: 1 as const, unresolvedCountry: "中国" as const
});
const failure = z.enum(["PDF_URL_INVALID","PDF_RESPONSE_INVALID","PDF_BODY_TOO_LARGE","PDF_MAGIC_INVALID","PDF_TRANSPORT_FAILED","PDF_PARSER_FAILED","PDF_RETAINED_BUDGET_EXCEEDED","PDF_RUNTIME_UNAVAILABLE"]);
export const astellasPdfCityEnvelopeSchema = z.object({
  schemaVersion: z.literal("astellas-owned-pdf-cities-v1"),
  runtimeCapability: z.discriminatedUnion("available",[
    z.object({available:z.literal(true),parserVersion:z.string().regex(/^poppler-\d+\.\d+\.\d+$/u)}).strict(),
    z.object({available:z.literal(false),code:z.literal("PDF_RUNTIME_UNAVAILABLE")}).strict()
  ]),
  sourceConfigSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  listArtifactLogicalKey: z.string().min(1),
  entries: z.array(z.object({
    sourceJobId: z.string().min(1), officialUrl: z.string().url(),
    artifactLogicalKey: z.string().min(1).optional(),
    outcome: z.discriminatedUnion("ok", [
      z.object({ok:z.literal(true), evidence:z.unknown()}).strict(),
      z.object({ok:z.literal(false), code:failure}).strict()
    ])
  }).strict()).max(ASTELLAS_PDF_CITY_CONFIG.maxDocuments)
}).strict();
export type AstellasPdfCityEnvelope = z.infer<typeof astellasPdfCityEnvelopeSchema>;
