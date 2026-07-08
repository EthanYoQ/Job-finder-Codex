import { candidateCompanies } from "../data/companyRegistry";
import { getP0ReadinessReport, type P0ReadinessReport } from "./p0Readiness";
import {
  toP0ReadinessInput,
  type PersistedReadinessCompanyRow
} from "./persistedReadiness";

export interface P0ReadinessPrismaDb {
  company: {
    findMany(args: {
      include: {
        sources: {
          include: {
            crawlObservations: {
              orderBy: { crawledAt: "desc" };
              take: 2;
            };
          };
        };
      };
      orderBy: { pinyinName: "asc" };
    }): Promise<PersistedReadinessCompanyRow[]>;
  };
}

const READINESS_COMPANY_QUERY = {
  include: {
    sources: {
      include: {
        crawlObservations: {
          orderBy: { crawledAt: "desc" as const },
          take: 2 as const
        }
      }
    }
  },
  orderBy: { pinyinName: "asc" as const }
};

export async function getP0ReadinessReportFromDb(
  db: P0ReadinessPrismaDb
): Promise<P0ReadinessReport> {
  const rows = await db.company.findMany(READINESS_COMPANY_QUERY);
  const persistedInput = toP0ReadinessInput(rows);

  return getP0ReadinessReport({
    companies: candidateCompanies,
    observationsBySource: persistedInput.observationsBySource ?? {}
  });
}
