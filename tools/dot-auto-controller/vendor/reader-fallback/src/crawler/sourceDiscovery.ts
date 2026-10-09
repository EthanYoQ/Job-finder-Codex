import { z } from "zod";
import type { ATSKind } from "../domain/company";

const AtsKindSchema = z.enum([
  "OFFICIAL_HTML",
  "OFFICIAL_JSON",
  "MOKA",
  "BEISEN_ZHIYE",
  "WORKDAY",
  "HOTJOB_WECRUIT",
  "SUCCESSFACTORS",
  "REDSEA",
  "BROWSER_FALLBACK",
  "UNKNOWN"
]) satisfies z.ZodType<ATSKind>;

const SourceDiscoveryCandidateSchema = z.object({
  companyId: z.string().min(1),
  companyName: z.string().min(1),
  officialWebsiteUrl: z.string().url(),
  officialEntryUrl: z.string().url(),
  officialChainEvidenceUrl: z.string().url(),
  atsKind: AtsKindSchema,
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  discoveryMethod: z.string().min(1),
  selectorHint: z.string().min(1).optional(),
  apiHint: z.string().min(1).optional(),
  formalEvidenceStatus: z.literal("DISCOVERED_NOT_COUNTED")
});

export type SourceDiscoveryCandidate = z.infer<typeof SourceDiscoveryCandidateSchema>;

export interface SourceDiscoverySummary {
  total: number;
  highConfidence: number;
  byAtsKind: Partial<Record<ATSKind, number>>;
}

export function parseSourceDiscoveryCandidates(input: unknown): SourceDiscoveryCandidate[] {
  return z.array(SourceDiscoveryCandidateSchema).parse(input);
}

export function summarizeSourceDiscoveryCandidates(
  candidates: readonly SourceDiscoveryCandidate[]
): SourceDiscoverySummary {
  const byAtsKind: Partial<Record<ATSKind, number>> = {};

  for (const candidate of candidates) {
    byAtsKind[candidate.atsKind] = (byAtsKind[candidate.atsKind] ?? 0) + 1;
  }

  return {
    total: candidates.length,
    highConfidence: candidates.filter((candidate) => candidate.confidence === "HIGH").length,
    byAtsKind
  };
}
