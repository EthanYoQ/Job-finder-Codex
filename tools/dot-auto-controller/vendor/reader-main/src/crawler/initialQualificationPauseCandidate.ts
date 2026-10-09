import type { InitialQualificationPauseEvidence } from "./initialQualificationPauseEvidence";

interface InitialQualificationPauseCandidateRow {
  id: string;
  status: string;
  commitSha: string;
  rosterHash: string;
  sourcePlanHash: string;
  sourceConfigHash: string;
  adapterBundleHash: string;
}

interface InitialQualificationPauseCandidateFindUniqueArgs {
  where: { id: string };
  select: Record<keyof InitialQualificationPauseCandidateRow, true>;
}

export interface InitialQualificationPauseCandidateDb {
  releaseCandidate: {
    findUnique(
      args: InitialQualificationPauseCandidateFindUniqueArgs
    ): Promise<InitialQualificationPauseCandidateRow | null>;
  };
}

export interface InitialQualificationPauseCandidatePrismaClient
  extends InitialQualificationPauseCandidateDb {
  $disconnect(): Promise<void>;
}

export interface ProductionInitialQualificationPauseCandidateDeps {
  createClient(databaseUrl: string): Promise<InitialQualificationPauseCandidatePrismaClient>;
  loadStatus(
    db: InitialQualificationPauseCandidateDb,
    evidence: InitialQualificationPauseEvidence
  ): Promise<string>;
}

const productionDeps: ProductionInitialQualificationPauseCandidateDeps = {
  createClient: async (databaseUrl) => {
    const { PrismaClient } = await import("@prisma/client");
    return new PrismaClient({ datasourceUrl: databaseUrl }) as unknown as InitialQualificationPauseCandidatePrismaClient;
  },
  loadStatus: loadInitialQualificationPauseCandidateStatus
};

export async function loadInitialQualificationPauseCandidateStatus(
  db: InitialQualificationPauseCandidateDb,
  evidence: InitialQualificationPauseEvidence
): Promise<string> {
  const candidate = await db.releaseCandidate.findUnique({
    where: { id: evidence.releaseCandidateId },
    select: {
      id: true,
      status: true,
      commitSha: true,
      rosterHash: true,
      sourcePlanHash: true,
      sourceConfigHash: true,
      adapterBundleHash: true
    }
  });
  if (!candidate) throw new Error("Initial qualification pause candidate is missing");
  if (
    candidate.id !== evidence.releaseCandidateId ||
    candidate.commitSha !== evidence.commitSha ||
    candidate.rosterHash !== evidence.rosterSha256 ||
    candidate.sourcePlanHash !== evidence.sourcePlanSha256 ||
    candidate.sourceConfigHash !== evidence.sourceConfigSha256 ||
    candidate.adapterBundleHash !== evidence.adapterBundleSha256
  ) {
    throw new Error("Initial qualification pause candidate identity does not match the evidence");
  }
  if (!candidate.status.trim()) throw new Error("Initial qualification pause candidate status is invalid");
  return candidate.status;
}

export async function loadProductionInitialQualificationPauseCandidateStatus(
  databaseUrl: string | undefined,
  evidence: InitialQualificationPauseEvidence,
  deps: ProductionInitialQualificationPauseCandidateDeps = productionDeps
): Promise<string> {
  const validatedDatabaseUrl = requirePostgresDatabaseUrl(databaseUrl);
  const client = await deps.createClient(validatedDatabaseUrl);
  try {
    return await deps.loadStatus(client, evidence);
  } finally {
    await client.$disconnect();
  }
}

function requirePostgresDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for initial qualification pause validation");
  }
  try {
    const parsed = new URL(databaseUrl);
    if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") || !parsed.hostname) {
      throw new Error("unsupported database URL");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for initial qualification pause validation");
  }
  return databaseUrl;
}
