import type { CrawlEvidenceIdentity } from "./crawlSummary";
import { crawlEvidenceIdentityFromRuntime } from "./crawlSummary";
import {
  resolveCurrentStagedScheduleAuthority,
  type StagedScheduleAuthorityDb
} from "./stagedScheduleAuthority";

export type StagedMonitoringIdentityDb = StagedScheduleAuthorityDb;

export interface StagedMonitoringPrismaClient extends StagedMonitoringIdentityDb {
  $disconnect(): Promise<void>;
}

export interface ProductionStagedMonitoringIdentityDeps {
  createClient(databaseUrl: string): Promise<StagedMonitoringPrismaClient>;
  loadIdentity(db: StagedMonitoringIdentityDb): Promise<CrawlEvidenceIdentity>;
}

const productionDeps: ProductionStagedMonitoringIdentityDeps = {
  createClient: async (databaseUrl) => {
    const { PrismaClient } = await import("@prisma/client");
    return new PrismaClient({ datasourceUrl: databaseUrl }) as unknown as StagedMonitoringPrismaClient;
  },
  loadIdentity: loadStagedMonitoringIdentity
};

export async function loadStagedMonitoringIdentity(
  db: StagedMonitoringIdentityDb
): Promise<CrawlEvidenceIdentity> {
  const authority = await resolveCurrentStagedScheduleAuthority(db);
  return crawlEvidenceIdentityFromRuntime(authority.identity);
}

export async function loadProductionStagedMonitoringIdentity(
  databaseUrl: string | undefined,
  deps: ProductionStagedMonitoringIdentityDeps = productionDeps
): Promise<CrawlEvidenceIdentity> {
  const validatedDatabaseUrl = requirePostgresDatabaseUrl(databaseUrl);
  const client = await deps.createClient(validatedDatabaseUrl);
  try {
    return await deps.loadIdentity(client);
  } finally {
    await client.$disconnect();
  }
}

function requirePostgresDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for staged monitoring authority");
  }
  try {
    const parsed = new URL(databaseUrl);
    if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") || !parsed.hostname) {
      throw new Error("unsupported database URL");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL for staged monitoring authority");
  }
  return databaseUrl;
}
