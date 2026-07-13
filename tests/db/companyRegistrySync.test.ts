import { describe, expect, it, vi } from "vitest";
import type { CandidateCompany } from "../../src/data/companyRegistry";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { syncPlannedSourcesToDb } from "../../src/db/companyRegistrySync";
import { confirmedCompanyRosterV3Members } from "../../src/data/confirmedCompanyRosterV3";
import { USER_AUTHORIZED_PHASE1_EXCLUSION } from "../../src/data/phase1ScopePolicy";

const firstMember = confirmedCompanyRosterV3Members[0]!;
const plannedCompany: CandidateCompany = {
  id: firstMember.id,
  officialChineseName: "测试药企",
  officialWebsiteUrl: "https://example.com",
  pinyinName: "ceshi-yaoqi",
  category: firstMember.category,
      targetStatus: "ACTIVE",
  sources: [
    {
      id: "source-test-social",
      companyId: firstMember.id,
      kind: "SOCIAL",
      atsKind: "MOKA",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
      officialChainEvidenceUrl: "https://example.com/careers"
    }
  ]
};

const rosterCompanies: CandidateCompany[] = confirmedCompanyRosterV3Members.map((member, index) => index === 0
  ? plannedCompany
  : { id: member.id, officialChineseName: `药企${index}`, officialWebsiteUrl: `https://company-${index}.example.com`,
      pinyinName: `company-${index}`, category: member.category,
      targetStatus: member.id === "company-humanwell" || member.id === "company-north-china-pharma"
        ? USER_AUTHORIZED_PHASE1_EXCLUSION : "BLOCKED_EVIDENCE_GAP",
      sources: [] });

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: {
    id: plannedCompany.id,
    officialChineseName: plannedCompany.officialChineseName,
    category: plannedCompany.category
  },
  source: {
    id: "source-test-social",
    companyId: plannedCompany.id,
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
    officialChainEvidenceUrl: "https://example.com/careers"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
};

function fakeDb() {
  const db = {
    company: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: unknown) => args)
    },
    recruitmentSource: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async (args: unknown) => args)
    },
    job: {
      updateMany: vi.fn(async () => ({ count: 3 }))
    },
    $transaction: vi.fn(async <T>(operation: (tx: any) => Promise<T>): Promise<T> => operation(db))
  };
  return db;
}

function transactionalFakeDb(existing: {
  companies?: Array<{ id: string }>;
  sources?: Array<{ id: string; companyId: string }>;
} = {}) {
  const committed: unknown[] = [];
  const companyUpsert = vi.fn(async (args: unknown) => { committed.push({ kind: "company", args }); });
  const sourceUpsert = vi.fn(async (args: unknown) => { committed.push({ kind: "source", args }); });
  const companyFindMany = vi.fn(async () => structuredClone(existing.companies ?? []));
  const sourceFindMany = vi.fn(async () => structuredClone(existing.sources ?? []));
  const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => {
    const staged: unknown[] = [];
    const tx = {
      company: {
        findMany: companyFindMany,
        upsert: vi.fn(async (args: unknown) => { staged.push({ kind: "company", args }); })
      },
      recruitmentSource: {
        findMany: sourceFindMany,
        upsert: vi.fn(async (args: unknown) => { staged.push({ kind: "source", args }); })
      }
    };
    const result = await operation(tx);
    for (const write of staged) {
      if ((write as { kind: string }).kind === "company") await companyUpsert((write as { args: unknown }).args);
      else await sourceUpsert((write as { args: unknown }).args);
    }
    return result;
  });
  return { db: { $transaction: transaction }, committed, transaction, companyFindMany, sourceFindMany,
    companyUpsert, sourceUpsert };
}

function rosterWithFirst(first: CandidateCompany): CandidateCompany[] {
  return rosterCompanies.map((company, index) => index === 0 ? first : company);
}

describe("syncPlannedSourcesToDb", () => {
  it("upserts every supplied roster company but only real planned sources", async () => {
    const db = fakeDb();

    const result = await syncPlannedSourcesToDb([plan], rosterCompanies, db as never);

    expect(result).toEqual({
      companyCount: 60,
      sourceCount: 1,
      hiddenUnplannedVisibleJobCount: 0
    });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.company.upsert).toHaveBeenCalledTimes(60);
    expect(db.recruitmentSource.upsert).toHaveBeenCalledTimes(1);
    expect(db.company.upsert.mock.calls.map(([args]) => (args as { where: { id: string } }).where.id))
      .toEqual(confirmedCompanyRosterV3Members.map((member) => member.id).sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))));
    expect(db.company.upsert).toHaveBeenCalledWith({
      where: { id: plannedCompany.id },
      create: {
        id: plannedCompany.id,
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: plannedCompany.category
      },
      update: {
        officialChineseName: "测试药企",
        officialWebsiteUrl: "https://example.com",
        pinyinName: "ceshi-yaoqi",
        inclusionReason: plannedCompany.category
      }
    });
    expect(db.recruitmentSource.upsert).toHaveBeenCalledWith({
      where: { id: "source-test-social" },
      create: {
        id: "source-test-social",
        companyId: plannedCompany.id,
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      },
      update: {
        companyId: plannedCompany.id,
        kind: "SOCIAL",
        atsKind: "MOKA",
        officialEntryUrl: "https://app.mokahr.com/apply/test#/jobs",
        officialChainEvidenceUrl: "https://example.com/careers",
        status: "VERIFIED_SCRAPABLE"
      }
    });
    expect(db.job.updateMany).not.toHaveBeenCalled();
  });

  it("requires plans to exactly cover the roster executable social source-ID set", async () => {
    const secondSource = {
      ...plannedCompany.sources[0]!,
      id: "source-test-secondary"
    };
    const companies = rosterWithFirst({ ...plannedCompany, sources: [...plannedCompany.sources, secondSource] });
    const db = fakeDb();

    await expect(syncPlannedSourcesToDb([plan], companies, db as never)).rejects.toThrow(/exact|source.*set|missing.*plan/i);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalled();
  });

  it("allows an official-link-only pending source to remain outside the executable plan", async () => {
    const pendingSource = {
      ...plannedCompany.sources[0]!,
      id: "source-test-pending",
      atsKind: "OFFICIAL_HTML" as const,
      status: "ENTRY_FOUND_PENDING_ADAPTER" as const,
      officialEntryUrl: "https://example.com/careers"
    };
    const companies = rosterWithFirst({
      ...plannedCompany,
      sources: [...plannedCompany.sources, pendingSource]
    });
    const db = fakeDb();

    await expect(syncPlannedSourcesToDb([plan], companies, db as never)).resolves.toMatchObject({
      companyCount: 60,
      sourceCount: 1
    });
    expect(db.recruitmentSource.upsert).toHaveBeenCalledTimes(1);
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: pendingSource.id } })
    );
  });

  it("retains legacy outside-roster rows while syncing the canonical roster", async () => {
    const fake = transactionalFakeDb({
      companies: [{ id: "company-legacy-outside-directory" }],
      sources: [{ id: "source-legacy-outside-directory", companyId: "company-legacy-outside-directory" }]
    });

    await expect(syncPlannedSourcesToDb([plan], rosterCompanies, fake.db as never)).resolves.toMatchObject({
      companyCount: 60,
      sourceCount: 1
    });
    expect(fake.companyUpsert).toHaveBeenCalledTimes(60);
    expect(fake.sourceUpsert).toHaveBeenCalledTimes(1);
  });

  it("rejects an authorized exclusion carrying a source before writes", async () => {
    const excluded = rosterCompanies.find((company) => company.id === "company-humanwell")!;
    const excludedSource = { ...plannedCompany.sources[0]!, id: "source-humanwell-social", companyId: excluded.id };
    const companies = rosterCompanies.map((company) => company.id === excluded.id
      ? { ...company, sources: [excludedSource] }
      : company);
    const db = fakeDb();

    await expect(syncPlannedSourcesToDb([plan], companies, db as never))
      .rejects.toThrow(/authorized exclusion|phase 1 exclusion|humanwell/i);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a crawl plan owned by a zero-source authorized exclusion at the plan guard", async () => {
    const excluded = rosterCompanies.find((company) => company.id === "company-humanwell")!;
    const excludedPlan = {
      ...plan,
      company: { ...plan.company, id: excluded.id, officialChineseName: excluded.officialChineseName, category: excluded.category },
      source: { ...plan.source, id: "source-humanwell-plan-only", companyId: excluded.id }
    };
    const db = fakeDb();

    await expect(syncPlannedSourcesToDb([plan, excludedPlan], rosterCompanies, db as never))
      .rejects.toThrow(/AUTHORIZED_PHASE1_EXCLUSION_HAS_PLAN:company-humanwell/);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate company rows", { companies: [{ id: plannedCompany.id }, { id: plannedCompany.id }] }],
    ["duplicate source rows", { sources: [{ id: plan.source.id, companyId: plannedCompany.id },
      { id: plan.source.id, companyId: plannedCompany.id }] }],
    ["reassociated source ownership", { sources: [{ id: plan.source.id, companyId: rosterCompanies[1]!.id }] }]
  ] as const)("rejects existing %s before the first transactional write", async (_label, existing) => {
    const fake = transactionalFakeDb(existing as never);

    await expect(syncPlannedSourcesToDb([plan], rosterCompanies, fake.db as never)).rejects.toThrow();

    expect(fake.transaction).toHaveBeenCalledTimes(1);
    expect(fake.companyFindMany).toHaveBeenCalledTimes(1);
    expect(fake.sourceFindMany).toHaveBeenCalledTimes(1);
    expect(fake.companyUpsert).not.toHaveBeenCalled();
    expect(fake.sourceUpsert).not.toHaveBeenCalled();
    expect(fake.committed).toEqual([]);
  });

  it("throws instead of writing fake company website URLs", async () => {
    const db = fakeDb();
    const { officialWebsiteUrl: _officialWebsiteUrl, ...companyWithoutWebsite } = plannedCompany;

    await expect(
      syncPlannedSourcesToDb([plan], rosterWithFirst(companyWithoutWebsite as CandidateCompany), db as never)
    ).rejects.toThrow(/officialWebsiteUrl|website/i);

    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.job.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate company", [plan], [...rosterCompanies, rosterCompanies[0]!]],
    ["missing plan company", [plan], rosterCompanies.slice(1)],
    ["same-category replacement", [{...plan,company:{...plan.company,id:"company-replacement"},source:{...plan.source,companyId:"company-replacement"}}], rosterWithFirst({ ...plannedCompany, id: "company-replacement", sources: plannedCompany.sources.map(source=>({...source,companyId:"company-replacement"})) })],
    ["source absent from roster", [plan], rosterWithFirst({ ...plannedCompany, sources: [] })],
    ["duplicate roster source", [plan], rosterWithFirst({ ...plannedCompany, sources: [...plannedCompany.sources, plannedCompany.sources[0]!] })],
    ["no-link company carrying source", [plan], rosterWithFirst({ ...plannedCompany, targetStatus: "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME" })],
    ["mismatched source ownership", [{ ...plan, source: { ...plan.source, companyId: "company-other" } }], rosterCompanies],
    ["missing plan company category", [{ ...plan, company: { id: plan.company.id, officialChineseName: plan.company.officialChineseName } }], rosterCompanies],
    ["mismatched plan company category", [{ ...plan, company: { ...plan.company, category: plan.company.category === "FOREIGN_PHARMA" ? "DOMESTIC_PHARMA" : "FOREIGN_PHARMA" } }], rosterCompanies],
    ["mismatched ATS", [{ ...plan, source: { ...plan.source, atsKind: "WORKDAY" } }], rosterCompanies],
    ["mismatched status", [{ ...plan, source: { ...plan.source, status: "ENTRY_FOUND_PENDING_ADAPTER" } }], rosterCompanies],
    ["mismatched official entry", [{ ...plan, source: { ...plan.source, officialEntryUrl: "https://other.example.com/jobs" } }], rosterCompanies],
    ["mismatched official chain", [{ ...plan, source: { ...plan.source, officialChainEvidenceUrl: "https://other.example.com/careers" } }], rosterCompanies],
    ["invalid company URL", [plan], rosterWithFirst({ ...plannedCompany, officialWebsiteUrl: "not-a-url" })],
    ["invalid official entry", [{ ...plan, source: { ...plan.source, officialEntryUrl: "ftp://example.com/jobs" } }], rosterCompanies],
    ["invalid official chain", [{ ...plan, source: { ...plan.source, officialChainEvidenceUrl: "/careers" } }], rosterCompanies],
    ["non-social source", [{ ...plan, source: { ...plan.source, kind: "CAMPUS" } }], rosterCompanies],
    ["duplicate planned source", [plan, plan], rosterCompanies]
  ])("prevalidates %s before the first write", async (_label, plans, companies) => {
    const db = fakeDb();
    await expect(syncPlannedSourcesToDb(plans as never, companies as never, db as never)).rejects.toThrow();
    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.recruitmentSource.upsert).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rolls back all staged upserts when a later source write fails", async () => {
    const committed: unknown[] = [];
    const transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => {
      const staged: unknown[] = [];
      const tx = { company: { findMany: vi.fn(async () => []),
          upsert: vi.fn(async (args: unknown) => { staged.push(args); }) },
        recruitmentSource: { findMany: vi.fn(async () => []),
          upsert: vi.fn(async () => { throw new Error("source write failed"); }) } };
      const result = await operation(tx);
      committed.push(...staged);
      return result;
    });
    await expect(syncPlannedSourcesToDb([plan], rosterCompanies, { $transaction: transaction } as never)).rejects.toThrow(/source write failed/i);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([]);
  });
});
