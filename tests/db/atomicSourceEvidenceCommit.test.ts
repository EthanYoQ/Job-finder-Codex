import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  executeAtomicSourceEvidenceCommit,
  executeManualSourceEvidenceCommit,
  createBatchWithPendingSourceResults,
  inspectPersistedAtomicCommitOutcome,
  type AtomicSourceEvidenceCommit,
  type PrismaAtomicSourceEvidenceDb
} from "../../src/db/ingestionRepository";
import type { IngestionCommand } from "../../src/crawler/ingestion";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import {
  atomicEvidenceFailureCode,
  type AtomicEvidenceFailureCode
} from "../../src/crawler/sourceFailureDiagnostics";

vi.mock("../../src/crawler/runtimeAtomicEvidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/crawler/runtimeAtomicEvidence")>()),
  verifyAtomicRuntimeCommitAttestation: () => undefined
}));

const H = "a".repeat(64);
const H2 = "b".repeat(64);
const REDACTION_SET = "5adb8c3d42601f14dc3c467830d23dcc75ffae17236d02c6bb26c6e31b1c3c8e";
const FROM = new Date("2026-07-10T08:00:00.000Z");
const TO = new Date("2026-07-10T08:01:00.000Z");
const CURRENT_SET = canonicalStringSetSha256(["source-1:job-1"]);
const EMPTY_SET = canonicalStringSetSha256([]);

const observationCommand: Extract<IngestionCommand, { type: "UPSERT_CRAWL_OBSERVATION" }> = {
  type: "UPSERT_CRAWL_OBSERVATION",
  observation: {
    id: "observation-local",
    sourceId: "source-1",
    crawledAt: TO,
    successful: true,
    stableRequiredFields: ["company", "title", "officialUrl", "location"],
    structuredJobCount: 1,
    expectedJobCount: 1,
    completenessStatus: "VERIFIED",
    completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
    completenessEvidenceUrl: "https://example.test/jobs",
    totalPages: 1,
    pageSize: 20,
    pagesVisited: 1
  }
};

const jobCommand: Extract<IngestionCommand, { type: "UPSERT_JOB" }> = {
  type: "UPSERT_JOB",
  dedupeKey: "source-1:job-1",
  lifecycleStatus: "ACTIVE",
  visibleInFrontend: true,
  isNew: false,
  firstSeenAt: FROM.toISOString(),
  lastSeenAt: TO.toISOString(),
  missingSuccessfulCrawlCount: 0,
  record: {
    companyId: "company-1",
    sourceId: "source-1",
    sourceKind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    officialChineseCompanyName: "测试药企",
    officialTitle: "Role one",
    officialUrl: "https://example.test/jobs/1",
    listUrl: "https://example.test/jobs",
    sourceJobId: "job-1",
    locationRaw: "上海",
    cities: ["上海"],
    category: "销售",
    isBaseline: true,
    evidence: {
      officialEntryUrl: "https://example.test/careers",
      officialChainEvidenceUrl: "https://example.test",
      capturedAt: TO.toISOString()
    }
  }
};

function validCommit(): AtomicSourceEvidenceCommit {
  const tuple = {
    releaseCandidateId: "rc-1",
    batchId: "batch-1",
    sourceId: "source-1",
    sourceResultId: "source-result-1"
  };

  return {
    sourceResult: {
      id: tuple.sourceResultId,
      releaseCandidateId: tuple.releaseCandidateId,
      batchId: tuple.batchId,
      sourceId: tuple.sourceId,
      transportState: "SUCCEEDED",
      adapterState: "SUCCEEDED",
      completenessState: "VERIFIED",
      atomicCommitState: "COMMITTED",
      sourceConfigHash: H,
      adapterVersion: "adapter@1",
      officialEntryId: "entry-1",
      officialSurfaceIds: ["surface-1"],
      officialChannelIds: ["channel-1"],
      startedAt: FROM,
      finishedAt: TO,
      rawCount: 2,
      parsedCount: 1,
      validCount: 1,
      normalizedCount: 1,
      dedupeInputCount: 1,
      dedupeOutputCount: 1,
      parseDiscardCount: 1,
      validationDiscardCount: 0,
      normalizationDiscardCount: 0,
      dedupeDiscardCount: 0,
      collisionCount: 0,
      discardCount: 1,
      expectedJobCount: 1,
      expectedEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      expectedSurfaceSha256: H,
      visitedSurfaceSha256: H,
      expectedChannelSha256: H,
      visitedChannelSha256: H,
      canonicalCurrentJobSetSha256: CURRENT_SET,
      canonicalGraceJobSetSha256: EMPTY_SET,
      canonicalVisibleJobSetSha256: CURRENT_SET
      ,canonicalOutputSetSha256: CURRENT_SET
      ,adapterInputCount: 1
      ,adapterOutputCount: 1
      ,adapterLossCount: 0
      ,adapterCollisionGroupCount: 0
      ,adapterReconciliationSha256: H
      ,collisionLedgerSha256: H
      ,completenessCertificate: null
      ,completenessCertificateSha256: null
      ,retryReasonCodes: []
    },
    observationProvenance: {
      ...tuple,
      commitSha: "1672ab167e2841887c3b1667b11bbafc5c35106a",
      rosterSha256: H,
      sourcePlanSha256: H,
      sourceConfigSha256: H,
      adapterVersion: "adapter@1",
      observedFrom: FROM,
      observedTo: TO,
      transportSucceeded: true,
      adapterSucceeded: true,
      completenessVerified: true,
      atomicCommitSucceeded: true,
      canonicalRawSha256: H,
      canonicalOutputSha256: CURRENT_SET,
      canonicalGraceSha256: EMPTY_SET,
      canonicalVisibleSha256: CURRENT_SET,
      expectedSurfaceSha256: H,
      visitedSurfaceSha256: H,
      expectedChannelSha256: H,
      visitedChannelSha256: H,
      paginationTraceSha256: H,
      officialEvidenceArtifactLogicalKey: "official"
      ,artifactRedactionCommitmentSha256: REDACTION_SET
    },
    artifacts: [
      {
        ...tuple,
        id: "artifact-1",
        logicalKey: "official",
        channelId: "channel-1",
        kind: "ATS_API_RESPONSE",
        requestedUrl: "https://example.test/api/jobs?page=1",
        finalUrl: "https://example.test/api/jobs?page=1",
        httpStatus: 200,
        contentType: "application/json",
        capturedAt: TO,
        sha256: H,
        byteCount: 123,
        path: "artifacts/source-1/page-1.json",
        extractorLocator: "$.total",
        captureToolName: "fetch",
        captureToolVersion: "1"
        ,redactionCommitmentSha256: H
      }
    ],
    pagination: [
      {
        ...tuple,
        artifactLogicalKey: "official",
        sequence: 0,
        channelId: "channel-1",
        requestedPage: 1,
        returnedPage: 1,
        requestedPageSize: 20,
        returnedPageSize: 20,
        responseFingerprintSha256: H,
        rawJobIdSetSha256: H2,
        validJobIdSetSha256: H2,
        declaredTotal: 1,
        declaredCount: 1,
        declaredPages: 1,
        termination: "DECLARED_TOTAL_REACHED",
        anomalyCodes: [],
        capturedAt: TO
      }
    ],
    lossLedger: [{
      ...tuple,
      stage: "PARSE",
      reason: "non-job envelope row",
      rawLocator: "$.rows[1]",
      details: { code: "NOT_A_JOB" }
    }],
    priorTransportAttempts: [{
      ...tuple,
      id: "attempt-1",
      sequence: 0,
      transport: "DIRECT_HTTP",
      outcome: "FAILED",
      code: "HCM_DIRECT_FAILED",
      capturedAt: FROM,
      evidenceCommitmentSha256: H,
      pageTraceSha256: H,
      lossLedgerSha256: H,
      paginationEvaluationSha256: H,
      artifactIds: ["artifact-1"],
      details: { failureClass: "TRANSPORT_FAILURE" }
    }],
    commands: [
      { ...observationCommand, observation: { ...observationCommand.observation } },
      {
        ...jobCommand,
        record: {
          ...jobCommand.record,
          cities: [...jobCommand.record.cities],
          evidence: { ...jobCommand.record.evidence }
        }
      }
    ]
  };
}

function retargetCommitSource(input: AtomicSourceEvidenceCommit, sourceId: string): void {
  input.sourceResult.sourceId = sourceId;
  input.observationProvenance.sourceId = sourceId;
  input.artifacts.forEach((row) => { row.sourceId = sourceId; });
  input.pagination.forEach((row) => { row.sourceId = sourceId; });
  input.lossLedger.forEach((row) => { row.sourceId = sourceId; });
  input.priorTransportAttempts.forEach((row) => { row.sourceId = sourceId; });
  input.commands.forEach((command) => {
    if (command.type === "UPSERT_JOB") command.record.sourceId = sourceId;
    if (command.type === "UPSERT_CRAWL_OBSERVATION") command.observation.sourceId = sourceId;
  });
}

function removeLifecycleCommands(input: AtomicSourceEvidenceCommit): void {
  input.commands=input.commands.filter(command=>command.type!=="UPSERT_JOB");
  input.sourceResult.canonicalGraceJobSetSha256=EMPTY_SET;
  input.sourceResult.canonicalVisibleJobSetSha256=EMPTY_SET;
  input.observationProvenance.canonicalGraceSha256=EMPTY_SET;
  input.observationProvenance.canonicalVisibleSha256=EMPTY_SET;
}

function markIncomplete(input: AtomicSourceEvidenceCommit): void {
  input.sourceResult.completenessState = "INCOMPLETE";
  input.sourceResult.expectedJobCount = 2;
  input.sourceResult.blockerCode = "OFFICIAL_TOTAL_NOT_REACHED";
  input.sourceResult.blockerReason = "Fetched 1 of official total 2";
  input.observationProvenance.completenessVerified = false;
  const observation = input.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
  if (observation?.type !== "UPSERT_CRAWL_OBSERVATION") throw new Error("Expected observation fixture");
  observation.observation.expectedJobCount = 2;
  observation.observation.completenessStatus = "INCOMPLETE";
  observation.observation.completenessBlockerReason = "Fetched 1 of official total 2";
}

function grifolsVerifiedScopeExclusionCommit(): AtomicSourceEvidenceCommit {
  const input = validCommit();
  retargetCommitSource(input, "source-grifols-china-social");
  const tuple = {
    releaseCandidateId: input.sourceResult.releaseCandidateId,
    batchId: input.sourceResult.batchId,
    sourceId: input.sourceResult.sourceId,
    sourceResultId: input.sourceResult.id
  };
  input.sourceResult.rawCount = 2;
  input.sourceResult.parsedCount = 2;
  input.sourceResult.validCount = 1;
  input.sourceResult.parseDiscardCount = 0;
  input.sourceResult.validationDiscardCount = 1;
  input.sourceResult.discardCount = 1;
  input.sourceResult.expectedJobCount = 2;
  input.pagination[0]!.declaredTotal = 2;
  input.pagination[0]!.declaredCount = 2;
  input.lossLedger = [{
    ...tuple,
    stage: "VALIDATION",
    reason: "official detail places the job outside mainland China",
    rawLocator: "grifols-detail-0001#grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location",
    details: { code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE", recordIndex: 1 }
  }];
  input.artifacts.push({
    ...input.artifacts[0]!,
    ...tuple,
    id: "artifact-grifols-detail-1",
    logicalKey: "grifols-detail-0001",
    kind: "ATS_PAGE",
    requestedUrl: "https://jobsearch.grifols.com/job/Home-Office/example/",
    finalUrl: "https://jobsearch.grifols.com/job/Home-Office/example/",
    sha256: H2,
    path: "artifacts/source-grifols-china-social/grifols-detail-0001.html",
    extractorLocator: "grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location",
    redactionCommitmentSha256: H2
  });
  input.observationProvenance.artifactRedactionCommitmentSha256 = canonicalStringSetSha256([H, H2]);
  const observation = input.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
  if (observation?.type !== "UPSERT_CRAWL_OBSERVATION") throw new Error("Expected observation fixture");
  observation.observation.expectedJobCount = 2;
  const collisionLedgerSha256 = sha256(canonicalJson([]));
  input.sourceResult.collisionLedgerSha256 = collisionLedgerSha256;
  const certificate = {
    schemaVersion: "a-grade-official-total-v2",
    grade: "A",
    binding: {
      releaseCandidateId: tuple.releaseCandidateId,
      batchId: tuple.batchId,
      sourceResultId: tuple.sourceResultId,
      sourceId: tuple.sourceId,
      sourceConfigSha256: H
    },
    scope: {
      companyId: "company-grifols-china",
      sourceId: tuple.sourceId,
      recruitmentType: "SOCIAL",
      geography: "MAINLAND_CHINA",
      businessUnit: "ALL",
      verificationPolicy: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1",
      surfaceIds: ["surface-1"],
      channelIds: ["channel-1"]
    },
    declaration: {
      kind: "OFFICIAL_TOTAL_COUNT",
      scope: "SOURCE",
      artifactLogicalKey: "official",
      artifactSha256: H,
      extractorLocator: "$.total"
    },
    counts: {
      officialTotal: 2,
      rawObservationCount: 2,
      rawUniqueOfficialRecordCount: 2,
      parsedCount: 2,
      validCount: 1,
      normalizedCount: 1,
      dedupeInputCount: 1,
      legalDedupeCount: 0,
      finalUniqueJobCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 1,
      normalizationDiscardCount: 0
    },
    legalDedupeLedger: [],
    legalScopeExclusionLedger: [{
      rawLocatorSha256: sha256("grifols-detail-0001#grifols-successfactors-detail-v1|html:canonical+streetAddress+content-location"),
      recordIndex: 1,
      code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE"
    }],
    pagination: {
      pageCount: 1,
      paginationTraceSha256: H,
      canonicalRawOfficialIdSetSha256: H
    },
    output: {
      canonicalJobSetSha256: CURRENT_SET,
      adapterReconciliationSha256: H,
      collisionLedgerSha256
    },
    observedAt: TO.toISOString()
  };
  input.sourceResult.completenessCertificate = certificate;
  input.sourceResult.completenessCertificateSha256 = sha256(canonicalJson(certificate));
  return input;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rocheVerifiedOfficialTotalDedupeCommit(): AtomicSourceEvidenceCommit {
  const input = validCommit();
  retargetCommitSource(input, "source-roche-china-social");
  const tuple = {
    releaseCandidateId: input.sourceResult.releaseCandidateId,
    batchId: input.sourceResult.batchId,
    sourceId: input.sourceResult.sourceId,
    sourceResultId: input.sourceResult.id
  };
  input.sourceResult.rawCount = 2;
  input.sourceResult.parsedCount = 2;
  input.sourceResult.validCount = 2;
  input.sourceResult.normalizedCount = 2;
  input.sourceResult.dedupeInputCount = 2;
  input.sourceResult.dedupeOutputCount = 1;
  input.sourceResult.parseDiscardCount = 0;
  input.sourceResult.validationDiscardCount = 0;
  input.sourceResult.normalizationDiscardCount = 0;
  input.sourceResult.dedupeDiscardCount = 1;
  input.sourceResult.collisionCount = 1;
  input.sourceResult.discardCount = 1;
  input.sourceResult.expectedJobCount = 2;
  input.sourceResult.adapterInputCount = 2;
  input.sourceResult.adapterOutputCount = 1;
  input.sourceResult.adapterLossCount = 1;
  input.sourceResult.adapterCollisionGroupCount = 1;
  const legalDedupeLedger = [{
    dedupeKeySha256: H,
    candidateKeySha256: [H, H2],
    winnerKeySha256: H,
    droppedCount: 1,
    dropReason: "DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER"
  }];
  const collisionLedgerSha256 = sha256(canonicalJson(legalDedupeLedger));
  input.sourceResult.collisionLedgerSha256 = collisionLedgerSha256;
  const certificate = {
    schemaVersion: "a-grade-official-total-v2",
    grade: "A",
    binding: {
      releaseCandidateId: tuple.releaseCandidateId,
      batchId: tuple.batchId,
      sourceResultId: tuple.sourceResultId,
      sourceId: tuple.sourceId,
      sourceConfigSha256: H
    },
    scope: {
      companyId: "company-roche-china",
      sourceId: tuple.sourceId,
      recruitmentType: "SOCIAL",
      geography: "MAINLAND_CHINA",
      businessUnit: "ALL",
      verificationPolicy: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1",
      surfaceIds: ["surface-1"],
      channelIds: ["channel-1"]
    },
    declaration: {
      kind: "OFFICIAL_TOTAL_COUNT",
      scope: "SOURCE",
      artifactLogicalKey: "official",
      artifactSha256: H,
      extractorLocator: "$.total"
    },
    counts: {
      officialTotal: 2,
      rawObservationCount: 2,
      rawUniqueOfficialRecordCount: 1,
      parsedCount: 2,
      validCount: 2,
      normalizedCount: 2,
      dedupeInputCount: 2,
      legalDedupeCount: 1,
      finalUniqueJobCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 0,
      normalizationDiscardCount: 0
    },
    legalDedupeLedger,
    pagination: {
      pageCount: 1,
      paginationTraceSha256: H,
      canonicalRawOfficialIdSetSha256: H
    },
    output: {
      canonicalJobSetSha256: CURRENT_SET,
      adapterReconciliationSha256: H,
      collisionLedgerSha256
    },
    observedAt: TO.toISOString()
  };
  input.sourceResult.completenessCertificate = certificate;
  input.sourceResult.completenessCertificateSha256 = sha256(canonicalJson(certificate));
  input.pagination[0]!.declaredTotal = 2;
  input.pagination[0]!.declaredCount = 2;
  input.lossLedger = [{
    ...tuple,
    stage: "DEDUPE",
    reason: "duplicate dedupe key; deterministic winner retained",
    rawLocator: "adapter:raw-index:1",
    details: {},
    candidateKey: "candidate-2",
    winnerKey: "candidate-1"
  }];
  const observation = input.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
  if (observation?.type !== "UPSERT_CRAWL_OBSERVATION") throw new Error("Expected observation fixture");
  observation.observation.expectedJobCount = 2;
  return input;
}

type Group = "sourceResults" | "artifacts" | "pagination" | "loss" | "priorAttempts" | "priorAttemptArtifacts" | "observations" | "jobs" | "lifecycleMembers";

function transactionalDb(failAt?: Group, sourceResultCount = 1, fenceRows: unknown[] = []): PrismaAtomicSourceEvidenceDb & {
  calls: Record<Group, unknown[]> & { transactions: number; order: Group[]; fences: unknown[] };
} {
  const calls = {
    transactions: 0,
    order: [] as Group[],
    fences: [] as unknown[],
    sourceResults: [] as unknown[],
    artifacts: [] as unknown[],
    pagination: [] as unknown[],
    loss: [] as unknown[],
    priorAttempts: [] as unknown[],
    priorAttemptArtifacts: [] as unknown[],
    observations: [] as unknown[],
    jobs: [] as unknown[]
    ,lifecycleMembers: [] as unknown[]
  };

  return {
    calls,
    $transaction: vi.fn(async (operation) => {
      calls.transactions += 1;
      const pending: Record<Group, unknown[]> = {
        sourceResults: [], artifacts: [], pagination: [], loss: [], priorAttempts: [], priorAttemptArtifacts: [], observations: [], jobs: [], lifecycleMembers: []
      };
      const create = (group: Group) => vi.fn(async (args: unknown) => {
        if (failAt === group) throw new Error(`injected ${group} failure`);
        pending[group].push(args);
        calls.order.push(group);
        return args;
      });
      const result = await operation({
        $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
          calls.fences.push({ sql, values });
          if (sql.includes('FROM "CrawlBatch"')) {
            return fenceRows.length === 0 ? [] : [{ id: values[0] }];
          }
          return fenceRows;
        }),
        crawlBatchSourceResult: { updateMany: vi.fn(async (args: unknown) => {
          if (failAt === "sourceResults") throw new Error("injected sourceResults failure");
          pending.sourceResults.push(args);
          calls.order.push("sourceResults");
          return { count: sourceResultCount };
        }) },
        evidenceArtifact: { create: create("artifacts") },
        paginationEvidence: { create: create("pagination") },
        lossLedgerEntry: { create: create("loss") },
        transportAttemptEvidence: { create: create("priorAttempts") },
        transportAttemptArtifact: { create: create("priorAttemptArtifacts") },
        crawlObservation: { create: create("observations") },
        job: { upsert: create("jobs") },
        lifecycleSetEvidenceMember:{create:create("lifecycleMembers")}
      });
      for (const group of Object.keys(pending) as Group[]) calls[group].push(...pending[group]);
      return result;
    })
  };
}

describe("executeAtomicSourceEvidenceCommit", () => {
  it("commits an A-grade official total with one exactly certified deterministic dedupe", async () => {
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(
      rocheVerifiedOfficialTotalDedupeCommit(), db
    )).resolves.toBeUndefined();
    expect(db.calls.sourceResults).toHaveLength(1);
    expect(db.calls.loss).toHaveLength(1);
  });

  it.each([
    ["non-dedupe loss", (input: AtomicSourceEvidenceCommit) => { input.lossLedger[0]!.stage = "VALIDATION"; }],
    ["missing winner", (input: AtomicSourceEvidenceCommit) => { delete input.lossLedger[0]!.winnerKey; }],
    ["uncertified source", (input: AtomicSourceEvidenceCommit) => {
      retargetCommitSource(input, "source-astellas-china-social");
    }]
  ])("rejects official-total dedupe relaxation with %s", async (_label, mutate) => {
    const input = rocheVerifiedOfficialTotalDedupeCommit();
    mutate(input);
    await expect(executeAtomicSourceEvidenceCommit(input, transactionalDb())).rejects.toThrow();
  });

  it("commits the exact Grifols official total after independently verified detail-scope exclusion", async () => {
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(grifolsVerifiedScopeExclusionCommit(), db)).resolves.toBeUndefined();
    expect(db.calls.sourceResults).toHaveLength(1);
    expect(db.calls.artifacts).toHaveLength(2);
    expect(db.calls.loss).toHaveLength(1);
  });

  it("does not expose the Grifols scope-exclusion path to another source", async () => {
    const input = grifolsVerifiedScopeExclusionCommit();
    retargetCommitSource(input, "source-astellas-china-social");
    await expect(executeAtomicSourceEvidenceCommit(input, transactionalDb())).rejects.toThrow();
  });

  it.each([
    ["an unregistered loss code", (input: AtomicSourceEvidenceCommit) => {
      input.lossLedger[0]!.details = { code: "OUT_OF_SCOPE", recordIndex: 1 };
    }],
    ["a missing detail artifact", (input: AtomicSourceEvidenceCommit) => {
      input.artifacts = input.artifacts.filter((artifact) => artifact.logicalKey !== "grifols-detail-0001");
      input.observationProvenance.artifactRedactionCommitmentSha256 = canonicalStringSetSha256([H]);
    }]
  ])("rejects Grifols-style count relaxation for %s", async (_label, mutate) => {
    const input = grifolsVerifiedScopeExclusionCommit();
    mutate(input);
    await expect(executeAtomicSourceEvidenceCommit(input, transactionalDb())).rejects.toMatchObject({
      atomicEvidencePersistenceStage: "ARTIFACT_VALIDATION"
    });
  });

  it("recognizes only an exactly matching persisted COMMITTED source result", async () => {
    const input = validCommit();
    const persisted: Record<string, unknown> = {
      ...input.sourceResult,
      blockerCode: null,
      blockerReason: null,
      failureCategory: null,
      failureDiagnosticCode: null,
      fetchAttemptCount: null,
      retryCount: null,
      failureCode: null,
      failureReason: null
    };
    const db = { crawlBatchSourceResult: { findUnique: vi.fn(async () => persisted) } };

    await expect(inspectPersistedAtomicCommitOutcome(input, db as never)).resolves.toEqual({
      state: "COMMITTED_EXACT"
    });

    persisted.canonicalOutputSetSha256 = H2;
    await expect(inspectPersistedAtomicCommitOutcome(input, db as never)).resolves.toEqual({
      state: "CONFLICT"
    });
    delete persisted.canonicalOutputSetSha256;
    await expect(inspectPersistedAtomicCommitOutcome(input, db as never)).resolves.toEqual({
      state: "CONFLICT"
    });
  });

  it("recognizes PENDING only when the immutable planned tuple matches", async () => {
    const input = validCommit();
    const persisted: Record<string, unknown> = {
      ...input.sourceResult,
      transportState: "PENDING",
      adapterState: "PENDING",
      completenessState: "PENDING",
      atomicCommitState: "PENDING"
    };
    const db = { crawlBatchSourceResult: { findUnique: vi.fn(async () => persisted) } };

    await expect(inspectPersistedAtomicCommitOutcome(input, db as never)).resolves.toEqual({ state: "PENDING" });
    persisted.sourceConfigHash = H2;
    await expect(inspectPersistedAtomicCommitOutcome(input, db as never)).resolves.toEqual({ state: "CONFLICT" });
  });

  it("commits all six write groups once in one transaction with exact direct provenance", async () => {
    const db = transactionalDb();
    const input = validCommit();
    await executeAtomicSourceEvidenceCommit(input, db);

    expect(db.calls.transactions).toBe(1);
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 10_000, timeout: 120_000 }
    );
    expect(db.calls.priorAttempts).toHaveLength(1);
    expect(db.calls.sourceResults).toHaveLength(1);
    expect(db.calls.artifacts).toHaveLength(1);
    expect(db.calls.pagination).toHaveLength(1);
    expect(db.calls.loss).toHaveLength(1);
    expect(db.calls.observations).toHaveLength(1);
    expect(db.calls.jobs).toHaveLength(1);
    expect(db.calls.lifecycleMembers).toHaveLength(2);
    expect(db.calls.sourceResults[0]).toMatchObject({
      where: {
        id: "source-result-1", releaseCandidateId: "rc-1", batchId: "batch-1",
        sourceId: "source-1", atomicCommitState: "PENDING"
      },
      data: { atomicCommitState: "COMMITTED", completenessState: "VERIFIED" }
    });
    expect(db.calls.order.at(-1)).toBe("sourceResults");
    expect(db.calls.artifacts[0]).toEqual({ data: {
      id: "artifact-1", releaseCandidateId: "rc-1", batchId: "batch-1",
      sourceId: "source-1", sourceResultId: "source-result-1", channelId: "channel-1",
      kind: "ATS_API_RESPONSE", requestedUrl: "https://example.test/api/jobs?page=1",
      finalUrl: "https://example.test/api/jobs?page=1", httpStatus: 200,
      contentType: "application/json", capturedAt: TO, sha256: H, byteCount: 123,
      path: "artifacts/source-1/page-1.json", extractorLocator: "$.total",
      captureToolName: "fetch", captureToolVersion: "1", redactionCommitmentSha256: H
    }});
    expect(db.calls.loss[0]).toEqual({ data: input.lossLedger[0] });
    expect(db.calls.observations[0]).toMatchObject({ data: {
      releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
      sourceResultId: "source-result-1", commitSha: "1672ab167e2841887c3b1667b11bbafc5c35106a",
      rosterSha256: H, sourcePlanSha256: H, sourceConfigSha256: H,
      adapterVersion: "adapter@1", observedFrom: FROM, observedTo: TO,
      successful: true, transportSucceeded: true, adapterSucceeded: true,
      completenessVerified: true, atomicCommitSucceeded: true,
      rawCount: 2, parsedCount: 1, validCount: 1, normalizedCount: 1,
      dedupeInputCount: 1, dedupeOutputCount: 1, structuredJobCount: 1,
      parseDiscardCount: 1, validationDiscardCount: 0, normalizationDiscardCount: 0,
      dedupeDiscardCount: 0, discardCount: 1, collisionCount: 0,
      expectedJobCount: 1, completenessStatus: "VERIFIED",
      completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
      completenessEvidenceUrl: "https://example.test/jobs",
      totalPages: 1, pageSize: 20, pagesVisited: 1,
      canonicalRawSha256: H, canonicalOutputSha256: CURRENT_SET, canonicalGraceSha256: EMPTY_SET,
      canonicalVisibleSha256: CURRENT_SET, expectedSurfaceSha256: H, visitedSurfaceSha256: H,
      expectedChannelSha256: H, visitedChannelSha256: H,
      officialEvidenceArtifactId: "artifact-1", paginationTraceSha256: H
    }});
    expect(db.calls.pagination[0]).toMatchObject({ data: {
      artifactId: "artifact-1", sourceResultId: "source-result-1", sequence: 0
    }});
  });

  const failureCodeByGroup: Record<Group, string> = {
    sourceResults: "ATOMIC_EVIDENCE_SOURCE_TERMINAL_WRITE_FAILED",
    artifacts: "ATOMIC_EVIDENCE_ARTIFACT_WRITE_FAILED",
    pagination: "ATOMIC_EVIDENCE_PAGINATION_WRITE_FAILED",
    loss: "ATOMIC_EVIDENCE_LOSS_LEDGER_WRITE_FAILED",
    priorAttempts: "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_WRITE_FAILED",
    priorAttemptArtifacts: "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_WRITE_FAILED",
    observations: "ATOMIC_EVIDENCE_OBSERVATION_WRITE_FAILED",
    jobs: "ATOMIC_EVIDENCE_JOB_WRITE_FAILED",
    lifecycleMembers: "ATOMIC_EVIDENCE_LIFECYCLE_WRITE_FAILED"
  };
  for (const group of ["sourceResults", "artifacts", "pagination", "loss", "priorAttempts", "priorAttemptArtifacts", "observations", "jobs","lifecycleMembers"] as Group[]) {
    it(`rolls back every pending write when ${group} fails`, async () => {
      const input = validCommit();
      const db = transactionalDb(group);
      const rejection = await executeAtomicSourceEvidenceCommit(input, db).catch((error: unknown) => error);
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as Error).message).toContain(`injected ${group} failure`);
      expect(atomicEvidenceFailureCode(rejection)).toBe(failureCodeByGroup[group]);
      expect(db.calls.transactions).toBe(1);
      for (const name of ["sourceResults", "artifacts", "pagination", "loss", "priorAttempts", "priorAttemptArtifacts", "observations", "jobs","lifecycleMembers"] as Group[]) {
        expect(db.calls[name]).toEqual([]);
      }
    });
  }

  it("classifies a generic failure after the transaction callback as a commit-boundary failure", async () => {
    const inner = transactionalDb();
    const transaction = inner.$transaction;
    const db: PrismaAtomicSourceEvidenceDb = {
      $transaction: async (operation, options) => {
        await transaction(operation, options);
        throw new Error("private deferred transaction failure");
      }
    };
    const rejection = await executeAtomicSourceEvidenceCommit(validCommit(), db).catch((error: unknown) => error);
    expect(atomicEvidenceFailureCode(rejection)).toBe("ATOMIC_EVIDENCE_TRANSACTION_COMMIT_FAILED");
  });

  const validationFailureCases: Array<[
    string,
    (input: AtomicSourceEvidenceCommit) => void,
    AtomicEvidenceFailureCode
  ]> = [
    ["source-result truth", (input) => {
      input.sourceResult.startedAt = new Date(TO.getTime() + 1);
    }, "ATOMIC_EVIDENCE_SOURCE_RESULT_VALIDATION_FAILED"],
    ["command projection", (input) => {
      input.commands = input.commands.filter((command) => command.type !== "UPSERT_CRAWL_OBSERVATION");
    }, "ATOMIC_EVIDENCE_COMMAND_VALIDATION_FAILED"],
    ["artifact metadata", (input) => {
      input.artifacts[0]!.sha256 = "invalid";
    }, "ATOMIC_EVIDENCE_ARTIFACT_VALIDATION_FAILED"],
    ["required completeness certificate", (input) => {
      retargetCommitSource(input, "source-astellas-china-social");
    }, "ATOMIC_EVIDENCE_CERTIFICATE_VALIDATION_FAILED"],
    ["certificate and hash pairing", (input) => {
      input.sourceResult.completenessCertificate = {};
    }, "ATOMIC_EVIDENCE_CERTIFICATE_VALIDATION_FAILED"],
    ["completeness certificate", (input) => {
      retargetCommitSource(input, "source-astellas-china-social");
      input.sourceResult.completenessCertificate = {};
      input.sourceResult.completenessCertificateSha256 = H;
    }, "ATOMIC_EVIDENCE_CERTIFICATE_VALIDATION_FAILED"],
    ["pagination", (input) => {
      input.pagination[0]!.sequence = 1;
    }, "ATOMIC_EVIDENCE_PAGINATION_VALIDATION_FAILED"],
    ["loss ledger", (input) => {
      input.lossLedger = [];
    }, "ATOMIC_EVIDENCE_LOSS_LEDGER_VALIDATION_FAILED"],
    ["adapter reconciliation", (input) => {
      input.sourceResult.adapterOutputCount = 0;
    }, "ATOMIC_EVIDENCE_RECONCILIATION_VALIDATION_FAILED"],
    ["transport attempt", (input) => {
      input.priorTransportAttempts[0]!.sequence = 1;
    }, "ATOMIC_EVIDENCE_TRANSPORT_ATTEMPT_VALIDATION_FAILED"],
    ["committed evidence", (input) => {
      input.observationProvenance.transportSucceeded = false;
    }, "ATOMIC_EVIDENCE_COMMITTED_EVIDENCE_VALIDATION_FAILED"]
  ];

  it.each(validationFailureCases)("classifies %s before opening a transaction", async (_label, mutate, expected) => {
    const input = validCommit();
    mutate(input);
    const db = transactionalDb();
    const rejection = await executeAtomicSourceEvidenceCommit(input, db).catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(Error);
    expect(atomicEvidenceFailureCode(rejection)).toBe(expected);
    expect(db.calls.transactions).toBe(0);
  });

  it("rolls back all evidence when no matching PENDING row is consumed", async () => {
    const db = transactionalDb(undefined, 0);
    await expect(executeAtomicSourceEvidenceCommit(validCommit(), db)).rejects.toThrow(/matching PENDING/i);
    for (const name of ["sourceResults", "artifacts", "pagination", "loss", "priorAttempts", "priorAttemptArtifacts", "observations", "jobs","lifecycleMembers"] as Group[]) {
      expect(db.calls[name]).toEqual([]);
    }
  });

  it("rejects tampered adapter reconciliation before the transaction", async () => {
    const input = validCommit();
    input.sourceResult.adapterOutputCount = 0;
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/adapter reconciliation/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects secret-like prior-attempt details before the transaction", async () => {
    const input = validCommit();
    input.priorTransportAttempts[0]!.details = { authorization: "example-placeholder" };
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/forbidden key/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects encoded or compatibility-normalized credential values before the transaction", async () => {
    const input = validCommit();
    input.priorTransportAttempts[0]!.details = { note: "%2542earer%2520sensitive" };
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/credential material/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("allows benign prose containing token as an ordinary word", async () => {
    const input = validCommit();
    input.priorTransportAttempts[0]!.details = { note: "pagination token count is zero" };
    await expect(executeAtomicSourceEvidenceCommit(input, transactionalDb())).resolves.toBeUndefined();
  });

  it("atomically persists the J&J direct failure and browser success transport chain", async () => {
    const input = validCommit();
    retargetCommitSource(input, "source-johnson-innovative-medicine-social");
    markIncomplete(input);
    input.priorTransportAttempts[0]!.code = "JNJ_DIRECT_FAILED";
    input.priorTransportAttempts.push({
      ...input.priorTransportAttempts[0]!,
      id: "attempt-2",
      sequence: 1,
      transport: "BROWSER_SESSION",
      outcome: "SUCCEEDED",
      code: "JNJ_BROWSER_SUCCEEDED",
      capturedAt: TO
    });

    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).resolves.toBeUndefined();
    expect(db.calls.priorAttempts).toEqual([
      { data: expect.objectContaining({
        sourceId: "source-johnson-innovative-medicine-social",
        transport: "DIRECT_HTTP", outcome: "FAILED", code: "JNJ_DIRECT_FAILED"
      }) },
      { data: expect.objectContaining({
        sourceId: "source-johnson-innovative-medicine-social",
        transport: "BROWSER_SESSION", outcome: "SUCCEEDED", code: "JNJ_BROWSER_SUCCEEDED"
      }) }
    ]);
    expect(db.calls.priorAttemptArtifacts).toHaveLength(2);
  });

  it("rejects J&J transport codes for any other source before the transaction", async () => {
    const input = validCommit();
    input.priorTransportAttempts[0]!.code = "JNJ_DIRECT_FAILED";
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/bound to the J&J China source/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects unknown transport-attempt codes before the transaction", async () => {
    const input = validCommit();
    (input.priorTransportAttempts[0] as { code: string }).code = "CALLER_DEFINED";
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/attempt code/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects transport-attempt codes paired with the wrong transport or outcome", async () => {
    const wrongTransport = validCommit();
    wrongTransport.priorTransportAttempts[0]!.transport = "BROWSER_SESSION";
    await expect(executeAtomicSourceEvidenceCommit(wrongTransport, transactionalDb())).rejects.toThrow(/inconsistent/i);

    const wrongSuccess = validCommit();
    wrongSuccess.priorTransportAttempts[0]!.code = "HCM_BROWSER_SUCCEEDED";
    wrongSuccess.priorTransportAttempts[0]!.outcome = "SUCCEEDED";
    wrongSuccess.priorTransportAttempts[0]!.transport = "DIRECT_HTTP";
    await expect(executeAtomicSourceEvidenceCommit(wrongSuccess, transactionalDb())).rejects.toThrow(/inconsistent/i);
  });

  it("rejects a prior transport attempt with zero artifact references", async () => {
    const input = validCommit();
    input.priorTransportAttempts[0]!.artifactIds = [];
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/artifact.*nonblank.*unique/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects zero page capacity before the transaction", async () => {
    const input = validCommit();
    input.pagination[0]!.requestedPageSize = 0;
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(/must be positive/i);
    expect(db.calls.transactions).toBe(0);
  });

  const rejectsBeforeTransaction = (
    name: string,
    mutate: (input: AtomicSourceEvidenceCommit) => void,
    message: RegExp
  ) => it(name, async () => {
    const input = validCommit();
    mutate(input);
    const db = transactionalDb();
    await expect(executeAtomicSourceEvidenceCommit(input, db)).rejects.toThrow(message);
    expect(db.calls.transactions).toBe(0);
  });

  rejectsBeforeTransaction("rejects caller-tampered lifecycle visibility", (x) => {
    const job=x.commands.find(command=>command.type==="UPSERT_JOB"); if(job?.type==="UPSERT_JOB")job.visibleInFrontend=false;
  }, /lifecycle.*status.*visibility/i);
  rejectsBeforeTransaction("rejects caller-tampered lifecycle miss count", (x) => {
    const job=x.commands.find(command=>command.type==="UPSERT_JOB"); if(job?.type==="UPSERT_JOB")job.missingSuccessfulCrawlCount=2;
  }, /lifecycle.*status.*visibility/i);
  rejectsBeforeTransaction("rejects caller-tampered lifecycle set hash", (x) => {
    x.sourceResult.canonicalVisibleJobSetSha256=H;
  }, /lifecycle.*sets.*hashes/i);
  rejectsBeforeTransaction("rejects a partial refresh that advances a missing count", (x) => {
    markIncomplete(x);
    const job=x.commands.find(command=>command.type==="UPSERT_JOB");
    if(job?.type==="UPSERT_JOB")job.missingSuccessfulCrawlCount=1;
  }, /partial.*currently observed active jobs/i);
  rejectsBeforeTransaction("rejects a partial refresh that hides an observed job", (x) => {
    markIncomplete(x);
    const job=x.commands.find(command=>command.type==="UPSERT_JOB");
    if(job?.type==="UPSERT_JOB")job.visibleInFrontend=false;
  }, /partial.*currently observed active jobs/i);
  rejectsBeforeTransaction("rejects a partial refresh with a mismatched current set hash", (x) => {
    markIncomplete(x);
    x.sourceResult.canonicalVisibleJobSetSha256=H;
  }, /partial current job set.*hashes/i);

  rejectsBeforeTransaction("rejects a missing designated official artifact", (x) => {
    x.observationProvenance.officialEvidenceArtifactLogicalKey = "missing";
  }, /official evidence artifact/i);

  rejectsBeforeTransaction("rejects fake official-total evidence from a non-network artifact", (x) => {
    x.artifacts[0]!.kind = "COMMAND_OUTPUT";
    delete x.artifacts[0]!.requestedUrl;
    delete x.artifacts[0]!.finalUrl;
    delete x.artifacts[0]!.httpStatus;
    delete x.artifacts[0]!.contentType;
  }, /OFFICIAL_TOTAL_COUNT.*network artifact/i);

  rejectsBeforeTransaction("rejects invalid loss reconciliation counts", (x) => {
    x.sourceResult.rawCount = 3;
  }, /loss reconciliation/i);

  rejectsBeforeTransaction("rejects tuple mismatch", (x) => {
    x.artifacts[0]!.batchId = "other-batch";
  }, /tuple/i);

  rejectsBeforeTransaction("rejects missing loss-ledger rows", (x) => {
    x.lossLedger = [];
  }, /loss ledger/i);

  rejectsBeforeTransaction("rejects a pagination reference outside the artifact set", (x) => {
    x.pagination[0]!.artifactLogicalKey = "missing";
  }, /pagination.*artifact/i);

  rejectsBeforeTransaction("rejects a non-contiguous pagination sequence", (x) => {
    x.pagination[0]!.sequence = 1;
  }, /contiguous.*zero/i);

  rejectsBeforeTransaction("rejects a bad pagination hash", (x) => {
    x.pagination[0]!.rawJobIdSetSha256 = "NOT-A-HASH";
  }, /sha256/i);

  rejectsBeforeTransaction("rejects anomaly-bearing VERIFIED completeness", (x) => {
    x.pagination[0]!.anomalyCodes = ["TOTAL_CHANGED"];
  }, /VERIFIED.*anomal/i);

  rejectsBeforeTransaction("rejects unsafe VERIFIED termination", (x) => {
    x.pagination[0]!.termination = "MAX_PAGE_LIMIT";
  }, /VERIFIED.*termination/i);

  rejectsBeforeTransaction("rejects a job from another source", (x) => {
    const command = x.commands[1];
    if (command?.type === "UPSERT_JOB") command.record.sourceId = "source-2";
  }, /job.*source/i);

  rejectsBeforeTransaction("requires exactly one observation command", (x) => {
    x.commands.push(observationCommand);
  }, /exactly one observation/i);

  rejectsBeforeTransaction("never derives official totals from jobs length", (x) => {
    x.sourceResult.expectedJobCount = null;
    const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type === "UPSERT_CRAWL_OBSERVATION") {
      delete observation.observation.expectedJobCount;
    }
  }, /OFFICIAL_TOTAL_COUNT.*expectedJobCount/i);

  rejectsBeforeTransaction("requires explicit VERIFIED set hashes", (x) => {
    x.sourceResult.canonicalVisibleJobSetSha256 = null;
  }, /VERIFIED.*hash|COMMITTED.*hash/i);

  rejectsBeforeTransaction("requires lowercase 64-hex direct hash provenance", (x) => {
    x.observationProvenance.rosterSha256 = "not-a-hash";
  }, /rosterSha256.*lowercase 64-hex/i);

  rejectsBeforeTransaction("rejects source-result and observation evidence hash mismatch", (x) => {
    x.observationProvenance.visitedChannelSha256 = H2;
  }, /evidence hashes.*source result/i);

  rejectsBeforeTransaction("validates job cities before opening the transaction", (x) => {
    const job = x.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type === "UPSERT_JOB") job.record.cities = [];
  }, /job.*cities/i);

  rejectsBeforeTransaction("validates job timestamps before opening the transaction", (x) => {
    const job = x.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type === "UPSERT_JOB") job.firstSeenAt = "not-a-date";
  }, /job.*timestamp/i);

  rejectsBeforeTransaction("rejects unordered job timestamps before opening the transaction", (x) => {
    const job = x.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type === "UPSERT_JOB") job.firstSeenAt = "2026-07-11T00:00:00.000Z";
  }, /job.*firstSeenAt.*lastSeenAt/i);

  for (const field of ["dedupeKey", "companyId", "officialTitle", "officialUrl", "locationRaw"] as const) {
    rejectsBeforeTransaction(`requires nonblank job ${field}`, (x) => {
      const job = x.commands.find((command) => command.type === "UPSERT_JOB");
      if (job?.type !== "UPSERT_JOB") return;
      if (field === "dedupeKey") job.dedupeKey = " ";
      else job.record[field] = " ";
    }, new RegExp(`job.*${field}`, "i"));
  }

  for (const [name, mutate] of [
    ["transport", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.transportState = "FAILED"; }],
    ["adapter", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.adapterState = "FAILED"; }],
    ["atomic", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.atomicCommitState = "PENDING"; }],
    ["finishedAt", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.finishedAt = null; }],
    ["transport boolean", (x: AtomicSourceEvidenceCommit) => { x.observationProvenance.transportSucceeded = false; }],
    ["adapter boolean", (x: AtomicSourceEvidenceCommit) => { x.observationProvenance.adapterSucceeded = false; }],
    ["completeness boolean", (x: AtomicSourceEvidenceCommit) => { x.observationProvenance.completenessVerified = false; }],
    ["atomic boolean", (x: AtomicSourceEvidenceCommit) => { x.observationProvenance.atomicCommitSucceeded = false; }],
    ["observation successful", (x: AtomicSourceEvidenceCommit) => {
      const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
      if (observation?.type === "UPSERT_CRAWL_OBSERVATION") observation.observation.successful = false;
    }]
  ] as const) {
    rejectsBeforeTransaction(`rejects inconsistent VERIFIED ${name} state`, mutate, /VERIFIED.*state|COMMITTED.*state|COMMITTED.*provenance/i);
  }

  rejectsBeforeTransaction("requires OFFICIAL_TOTAL_COUNT to equal dedupe output", (x) => {
    x.sourceResult.expectedJobCount = 2;
    const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type === "UPSERT_CRAWL_OBSERVATION") observation.observation.expectedJobCount = 2;
  }, /OFFICIAL_TOTAL_COUNT.*dedupeOutput/i);

  rejectsBeforeTransaction("requires expected and visited surface hashes to match", (x) => {
    x.sourceResult.visitedSurfaceSha256 = H2;
    x.observationProvenance.visitedSurfaceSha256 = H2;
  }, /expected.*visited.*surface/i);

  rejectsBeforeTransaction("requires expected and visited channel hashes to match", (x) => {
    x.sourceResult.visitedChannelSha256 = H2;
    x.observationProvenance.visitedChannelSha256 = H2;
  }, /expected.*visited.*channel/i);

  rejectsBeforeTransaction("requires pagination evidence for VERIFIED completeness", (x) => {
    x.pagination = [];
    const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type === "UPSERT_CRAWL_OBSERVATION") observation.observation.pagesVisited = 0;
  }, /VERIFIED.*pagination|COMMITTED.*pagination/i);

  rejectsBeforeTransaction("requires pagesVisited to equal pagination rows", (x) => {
    const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type === "UPSERT_CRAWL_OBSERVATION") observation.observation.pagesVisited = 2;
  }, /pagesVisited.*pagination/i);

  it("counts two dedupe losers with one winner as one collision group", async () => {
    const x = validCommit();
    x.sourceResult.rawCount = 4;
    x.sourceResult.parsedCount = 3;
    x.sourceResult.validCount = 3;
    x.sourceResult.normalizedCount = 3;
    x.sourceResult.dedupeInputCount = 3;
    x.sourceResult.dedupeDiscardCount = 2;
    x.sourceResult.collisionCount = 1;
    x.sourceResult.discardCount = 3;
    x.sourceResult.adapterInputCount = 3;
    x.sourceResult.adapterOutputCount = 1;
    x.sourceResult.adapterLossCount = 2;
    x.sourceResult.adapterCollisionGroupCount = 1;
    x.lossLedger.push(
      { releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1", sourceResultId: "source-result-1",
        stage: "DEDUPE", reason: "duplicate", rawLocator: "$.rows[2]", details: {}, candidateKey: "loser-1", winnerKey: "winner-1" },
      { releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1", sourceResultId: "source-result-1",
        stage: "DEDUPE", reason: "duplicate", rawLocator: "$.rows[3]", details: {}, candidateKey: "loser-2", winnerKey: "winner-1" }
    );
    const db = transactionalDb();
    await executeAtomicSourceEvidenceCommit(x, db);
    expect(db.calls.transactions).toBe(1);
    expect(db.calls.loss).toHaveLength(3);
  });

  rejectsBeforeTransaction("requires complete candidate and winner keys for dedupe loss", (x) => {
    x.sourceResult.rawCount = 3;
    x.sourceResult.parsedCount = 2;
    x.sourceResult.validCount = 2;
    x.sourceResult.normalizedCount = 2;
    x.sourceResult.dedupeInputCount = 2;
    x.sourceResult.dedupeDiscardCount = 1;
    x.sourceResult.discardCount = 2;
    x.lossLedger.push({ releaseCandidateId: "rc-1", batchId: "batch-1", sourceId: "source-1",
      sourceResultId: "source-result-1", stage: "DEDUPE", reason: "duplicate",
      rawLocator: "$.rows[2]", details: {}, candidateKey: "loser" });
  }, /dedupe loss.*candidateKey.*winnerKey/i);

  rejectsBeforeTransaction("validates observation crawledAt before opening the transaction", (x) => {
    const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type === "UPSERT_CRAWL_OBSERVATION") {
      observation.observation.crawledAt = new Date("invalid");
    }
  }, /observation crawledAt.*invalid/i);

  rejectsBeforeTransaction("validates job officialPublishedAt before opening the transaction", (x) => {
    const job = x.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type === "UPSERT_JOB") job.record.officialPublishedAt = "invalid";
  }, /job.*officialPublishedAt.*invalid/i);

  rejectsBeforeTransaction("requires nonnegative integer missingSuccessfulCrawlCount", (x) => {
    const job = x.commands.find((command) => command.type === "UPSERT_JOB");
    if (job?.type === "UPSERT_JOB") job.missingSuccessfulCrawlCount = -1;
  }, /job.*missingSuccessfulCrawlCount.*nonnegative integer/i);

  for (const field of ["totalPages", "pageSize", "pagesVisited"] as const) {
    rejectsBeforeTransaction(`requires nonnegative integer observation ${field}`, (x) => {
      const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
      if (observation?.type === "UPSERT_CRAWL_OBSERVATION") {
        observation.observation[field] = -1;
      }
    }, new RegExp(`observation ${field}.*nonnegative integer`, "i"));
  }

  it("commits truthful INCOMPLETE official-total evidence when expected exceeds output", async () => {
    const input = validCommit();
    markIncomplete(input);

    const db = transactionalDb();
    await executeAtomicSourceEvidenceCommit(input, db);

    expect(db.calls.transactions).toBe(1);
    expect(db.calls.jobs).toHaveLength(1);
    expect(db.calls.lifecycleMembers).toEqual([]);
    expect(db.calls.sourceResults).toHaveLength(1);
    expect(db.calls.observations[0]).toMatchObject({ data: {
      completenessStatus: "INCOMPLETE",
      completenessVerified: false,
      expectedJobCount: 2,
      dedupeOutputCount: 1,
      completenessBlockerReason: "Fetched 1 of official total 2",
      officialEvidenceArtifactId: "artifact-1"
    }});
  });

  it("commits NEEDS_MANUAL_COMPLETENESS_REVIEW with blocker and preserved evidence", async () => {
    const input = validCommit();
    retargetCommitSource(input, "source-gsk-china-social");
    input.sourceResult.completenessState = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    input.sourceResult.blockerCode = "MANUAL_ORACLE_REQUIRED";
    input.sourceResult.blockerReason = "Official response has no trustworthy declared total";
    input.sourceResult.expectedJobCount = null;
    input.sourceResult.expectedEvidenceKind = "COMPLETE_PAGE_TRAVERSAL";
    input.observationProvenance.completenessVerified = false;
    const observation = input.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
    if (observation?.type !== "UPSERT_CRAWL_OBSERVATION") throw new Error("Expected observation fixture");
    delete observation.observation.expectedJobCount;
    observation.observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
    observation.observation.completenessEvidenceKind = "COMPLETE_PAGE_TRAVERSAL";
    observation.observation.completenessBlockerReason = input.sourceResult.blockerReason;

    const db = transactionalDb();
    await executeAtomicSourceEvidenceCommit(input, db);
    expect(db.calls.jobs).toHaveLength(1);
    expect(db.calls.lifecycleMembers).toEqual([]);
    expect(db.calls.sourceResults[0]).toMatchObject({ data: {
      completenessState: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
      blockerCode: "MANUAL_ORACLE_REQUIRED"
    }});
    expect(db.calls.order.at(-1)).toBe("sourceResults");
  });

  for (const [name, mutate] of [
    ["COMMITTED FAILED completeness", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.completenessState = "FAILED"; }],
    ["COMMITTED transport failure", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.transportState = "FAILED"; }],
    ["COMMITTED adapter failure", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.adapterState = "FAILED"; }],
    ["COMMITTED failure code", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.failureCode = "SHOULD_BE_NULL"; }],
    ["VERIFIED blocker", (x: AtomicSourceEvidenceCommit) => { x.sourceResult.blockerCode = "SHOULD_BE_NULL"; }],
    ["VERIFIED GSK without A-grade certificate", (x: AtomicSourceEvidenceCommit) => {
      x.sourceResult.sourceId = "source-gsk-china-social";
    }],
    ["INCOMPLETE missing blocker", (x: AtomicSourceEvidenceCommit) => {
      x.sourceResult.completenessState = "INCOMPLETE";
      x.sourceResult.blockerCode = null;
      x.sourceResult.blockerReason = null;
      x.observationProvenance.completenessVerified = false;
      const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
      if (observation?.type === "UPSERT_CRAWL_OBSERVATION") observation.observation.completenessStatus = "INCOMPLETE";
    }],
    ["NEEDS_MANUAL missing blocker", (x: AtomicSourceEvidenceCommit) => {
      x.sourceResult.completenessState = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
      x.sourceResult.blockerCode = null;
      x.sourceResult.blockerReason = null;
      x.observationProvenance.completenessVerified = false;
      const observation = x.commands.find((command) => command.type === "UPSERT_CRAWL_OBSERVATION");
      if (observation?.type === "UPSERT_CRAWL_OBSERVATION") {
        observation.observation.completenessStatus = "NEEDS_MANUAL_COMPLETENESS_REVIEW";
      }
    }]
  ] as const) {
    rejectsBeforeTransaction(`rejects ${name}`, mutate, /COMMITTED|VERIFIED|blocker|terminal|certificate/i);
  }
});

describe("executeManualSourceEvidenceCommit", () => {
  const fence = { requestId: "request-1", ownerId: "worker-new" };

  it("rejects a reclaimed stale owner before any evidence, observation, lifecycle or job write", async () => {
    const input = validCommit();
    removeLifecycleCommands(input);
    const db = transactionalDb(undefined, 1, []);

    await expect(executeManualSourceEvidenceCommit(input, fence, db))
      .rejects.toMatchObject({ code: "MANUAL_CRAWL_OWNERSHIP_LOST" });

    expect(db.calls.fences).toHaveLength(1);
    for (const group of ["sourceResults", "artifacts", "pagination", "loss", "priorAttempts",
      "priorAttemptArtifacts", "observations", "jobs", "lifecycleMembers"] as Group[]) {
      expect(db.calls[group]).toEqual([]);
    }
  });

  it("lets only the reclaimed worker commit and keeps manual evidence free of Job/lifecycle mutation", async () => {
    const stale = validCommit();
    removeLifecycleCommands(stale);
    const staleDb = transactionalDb(undefined, 1, []);
    await expect(executeManualSourceEvidenceCommit(stale, { ...fence, ownerId: "worker-old" }, staleDb))
      .rejects.toMatchObject({ code: "MANUAL_CRAWL_OWNERSHIP_LOST" });

    const current = validCommit();
    removeLifecycleCommands(current);
    const currentDb = transactionalDb(undefined, 1, [{ id: fence.requestId }]);
    await executeManualSourceEvidenceCommit(current, fence, currentDb);

    expect(currentDb.calls.fences).toHaveLength(2);
    expect(currentDb.calls.fences[0]).toMatchObject({ values: [fence.requestId, fence.ownerId,
      current.sourceResult.sourceId] });
    expect(currentDb.calls.fences[0]).toMatchObject({ sql: expect.stringContaining('FROM "ManualCrawlRequest"') });
    expect(currentDb.calls.fences[0]).toMatchObject({ sql: expect.stringContaining('"sourceId" = $3') });
    expect(currentDb.calls.fences[0]).toMatchObject({ sql: expect.stringContaining("clock_timestamp()") });
    expect(currentDb.calls.fences[0]).toMatchObject({ sql: expect.stringContaining("FOR UPDATE") });
    expect(currentDb.calls.fences[1]).toMatchObject({ values: [current.sourceResult.batchId,
      fence.requestId, fence.ownerId] });
    expect(currentDb.calls.fences[1]).toMatchObject({ sql: expect.stringContaining('FROM "CrawlBatch"') });
    expect(currentDb.calls.fences[1]).toMatchObject({ sql: expect.stringContaining('"manualCrawlRequestId" = $2') });
    expect(currentDb.calls.fences[1]).toMatchObject({ sql: expect.stringContaining('"ownerId" = $3') });
    expect(currentDb.calls.fences[1]).toMatchObject({ sql: expect.stringContaining("FOR UPDATE") });
    expect(currentDb.calls.observations).toHaveLength(1);
    expect(currentDb.calls.artifacts).toHaveLength(1);
    expect(currentDb.calls.jobs).toEqual([]);
    expect(currentDb.calls.lifecycleMembers).toEqual([]);
    expect(currentDb.calls.sourceResults).toHaveLength(1);
  });

  it("rejects a manual commit containing canonical Job commands before opening a transaction", async () => {
    const db = transactionalDb(undefined, 1, [{ id: fence.requestId }]);
    await expect(executeManualSourceEvidenceCommit(validCommit(), fence, db))
      .rejects.toThrow(/manual.*job.*lifecycle/i);
    expect(db.calls.transactions).toBe(0);
  });

  it("rejects old-owner or source-mismatched atomic fences before any evidence write", async () => {
    for (const mismatch of ["OLD_OWNER", "SOURCE"] as const) {
      const input = validCommit(); removeLifecycleCommands(input);
      const db = transactionalDb(undefined, 1, []);
      await expect(executeManualSourceEvidenceCommit(input, {
        requestId: "request-1", ownerId: mismatch === "OLD_OWNER" ? "worker-old" : "worker-new"
      }, db)).rejects.toMatchObject({ code: "MANUAL_CRAWL_OWNERSHIP_LOST" });
      expect(db.calls.artifacts).toEqual([]);
    }
  });
});

describe.runIf(Boolean(process.env.TASK3B_CLONE_DATABASE_URL))("Task3B real clone repository runtime",()=>{
  it("keeps per-job checks lean while the final deferred source trigger rolls back a wrong full-set hash",async()=>{
    const {PrismaClient}=await import("@prisma/client");const prisma=new PrismaClient({datasourceUrl:process.env.TASK3B_CLONE_DATABASE_URL!});
    try{
      const [memberValidator]=await prisma.$queryRawUnsafe<Array<{definition:string}>>(
        `SELECT pg_get_functiondef('public.validate_lifecycle_set_member_projection()'::regprocedure) AS definition`);
      expect(memberValidator?.definition).toContain("invalid lifecycle set member cross-set projection");
      expect(memberValidator?.definition).not.toContain("assert_verified_parent_lifecycle_projection");
      const [sourceTrigger]=await prisma.$queryRawUnsafe<Array<{definition:string;deferrable:boolean;initiallyDeferred:boolean}>>(
        `SELECT pg_get_triggerdef(oid) AS definition, tgdeferrable AS deferrable, tginitdeferred AS "initiallyDeferred"
         FROM pg_trigger WHERE tgname='CrawlBatchSourceResult_verified_lifecycle_projection' AND NOT tgisinternal`);
      expect(sourceTrigger).toMatchObject({deferrable:true,initiallyDeferred:true});
      expect(sourceTrigger?.definition).toMatch(/DEFERRABLE INITIALLY DEFERRED/);
      const company=await prisma.company.upsert({where:{officialChineseName:"Grifols runtime fixture"},update:{},create:{id:"company-grifols-runtime",officialChineseName:"Grifols runtime fixture",officialWebsiteUrl:"https://www.grifols.com/",pinyinName:"grifols-runtime",inclusionReason:"real PostgreSQL atomic evidence test"}});
      const source=await prisma.recruitmentSource.upsert({where:{id:"source-task3b-runtime"},update:{},create:{id:"source-task3b-runtime",companyId:company.id,kind:"SOCIAL",atsKind:"OFFICIAL_JSON",officialEntryUrl:"https://example.test/jobs",officialChainEvidenceUrl:"https://example.test/careers",status:"VERIFIED_SCRAPABLE"}});const rc="task3b-runtime-rc";
      const grifolsSource=await prisma.recruitmentSource.upsert({where:{id:"source-grifols-china-social"},update:{},create:{id:"source-grifols-china-social",companyId:company.id,kind:"SOCIAL",atsKind:"SUCCESSFACTORS",officialEntryUrl:"https://jobsearch.grifols.com/",officialChainEvidenceUrl:"https://www.grifols.com/en/careers",status:"VERIFIED_SCRAPABLE"}});
      const rocheCompany=await prisma.company.upsert({where:{officialChineseName:"Roche runtime fixture"},update:{},create:{id:"company-roche-china",officialChineseName:"Roche runtime fixture",officialWebsiteUrl:"https://www.roche.com/",pinyinName:"roche-runtime",inclusionReason:"real PostgreSQL certified dedupe test"}});
      const rocheSource=await prisma.recruitmentSource.upsert({where:{id:"source-roche-china-social"},update:{},create:{id:"source-roche-china-social",companyId:rocheCompany.id,kind:"SOCIAL",atsKind:"OFFICIAL_JSON",officialEntryUrl:"https://careers.roche.com/cn/zh/search-results",officialChainEvidenceUrl:"https://careers.roche.com/cn/zh/mainland-china-jobs",status:"VERIFIED_SCRAPABLE"}});
      await prisma.releaseCandidate.create({data:{id:rc,goalId:"task3b-runtime",version:1,commitSha:"1".repeat(40),sourceTreeHash:H,runtimeTreeHash:H,dbSnapshotHash:H,schemaHash:H,migrationVersion:"task3b",rosterHash:H,sourcePlanHash:H,sourceConfigHash:H,adapterBundleHash:H,oracleVersion:"task3b",status:"BUILDING"}});
      const prepare=async(batchId:string,resultId:string,target=source)=>createBatchWithPendingSourceResults({batch:{id:batchId,releaseCandidateId:rc,commitSha:"1".repeat(40),rosterSha256:H,sourcePlanSha256:H,sourceConfigSha256:H,adapterBundleSha256:H,kind:"FULL_RELEASE",plannedSourceIds:[target.id],plannedSourceSetSha256:canonicalStringSetSha256([target.id]),plannedSourceCount:1,ownerId:"task3b",heartbeatAt:FROM,startedAt:FROM},sources:[{id:resultId,sourceId:target.id,sourceConfigHash:H,adapterVersion:"adapter@1",officialEntryId:"entry-1",officialSurfaceIds:["surface-1"],officialChannelIds:["channel-1"],startedAt:FROM}]},prisma as never);
      const adapt=(batchId:string,resultId:string,suffix:string,input:AtomicSourceEvidenceCommit=validCommit(),target=source)=>{const x=input;const artifactIds=new Map(x.artifacts.map(a=>[a.id,`artifact-${suffix}-${a.logicalKey}`]));x.sourceResult={...x.sourceResult,id:resultId,batchId,releaseCandidateId:rc,sourceId:target.id};x.observationProvenance={...x.observationProvenance,batchId,releaseCandidateId:rc,sourceId:target.id,sourceResultId:resultId};x.artifacts=x.artifacts.map(a=>({...a,id:artifactIds.get(a.id)!,path:`artifacts/${suffix}/${a.logicalKey}`,batchId,releaseCandidateId:rc,sourceId:target.id,sourceResultId:resultId}));x.pagination=x.pagination.map(p=>({...p,batchId,releaseCandidateId:rc,sourceId:target.id,sourceResultId:resultId}));x.lossLedger=x.lossLedger.map(v=>({...v,batchId,releaseCandidateId:rc,sourceId:target.id,sourceResultId:resultId}));x.priorTransportAttempts=x.priorTransportAttempts.map(v=>({...v,id:`attempt-${suffix}`,artifactIds:v.artifactIds.map(id=>artifactIds.get(id)!),batchId,releaseCandidateId:rc,sourceId:target.id,sourceResultId:resultId}));x.commands=x.commands.map(c=>c.type==="UPSERT_JOB"?{...c,record:{...c.record,companyId:target.companyId,sourceId:target.id}}:{...c,observation:{...c.observation,sourceId:target.id}});if(x.sourceResult.completenessCertificate&&typeof x.sourceResult.completenessCertificate==="object"&&!Array.isArray(x.sourceResult.completenessCertificate)){const prior=x.sourceResult.completenessCertificate as Record<string,any>;const certificate={...prior,binding:{...prior.binding,releaseCandidateId:rc,batchId,sourceResultId:resultId,sourceId:target.id}};x.sourceResult.completenessCertificate=certificate;x.sourceResult.completenessCertificateSha256=sha256(canonicalJson(certificate));}return x};
      await prepare("task3b-runtime-ok","task3b-runtime-result-ok");await executeAtomicSourceEvidenceCommit(adapt("task3b-runtime-ok","task3b-runtime-result-ok","ok"),prisma as never);
      expect(await prisma.lifecycleSetEvidenceMember.count({where:{sourceResultId:"task3b-runtime-result-ok"}})).toBe(2);
      await prepare("task3b-runtime-fail","task3b-runtime-result-fail");const before=await prisma.crawlObservation.count({where:{sourceResultId:"task3b-runtime-result-fail"}});
      const injected={$transaction:<T>(op:(tx:any)=>Promise<T>)=>prisma.$transaction(tx=>op({...tx,lifecycleSetEvidenceMember:{create:async()=>{throw new Error("injected lifecycle member failure")}}}))};
      await expect(executeAtomicSourceEvidenceCommit(adapt("task3b-runtime-fail","task3b-runtime-result-fail","fail"),injected as never)).rejects.toThrow(/injected lifecycle/);
      expect(await prisma.crawlObservation.count({where:{sourceResultId:"task3b-runtime-result-fail"}})).toBe(before);expect(await prisma.evidenceArtifact.count({where:{sourceResultId:"task3b-runtime-result-fail"}})).toBe(0);expect(await prisma.lifecycleSetEvidenceMember.count({where:{sourceResultId:"task3b-runtime-result-fail"}})).toBe(0);
      expect((await prisma.crawlBatchSourceResult.findUniqueOrThrow({where:{id:"task3b-runtime-result-fail"}})).atomicCommitState).toBe("PENDING");
      await prepare("task3b-runtime-wrong-hash","task3b-runtime-result-wrong-hash");
      const tamperedDb={$transaction:<T>(op:(tx:any)=>Promise<T>,options?:{maxWait?:number;timeout?:number})=>
        prisma.$transaction(tx=>op({...tx,crawlBatchSourceResult:{...tx.crawlBatchSourceResult,
          updateMany:(args:any)=>tx.crawlBatchSourceResult.updateMany({...args,data:{...args.data,
            canonicalCurrentJobSetSha256:H2,canonicalOutputSetSha256:H2}})},
          crawlObservation:{...tx.crawlObservation,create:(args:any)=>tx.crawlObservation.create({data:{...args.data,
            canonicalOutputSha256:H2}})}}),options)};
      await expect(executeAtomicSourceEvidenceCommit(
        adapt("task3b-runtime-wrong-hash","task3b-runtime-result-wrong-hash","wrong-hash"),tamperedDb as never
      )).rejects.toThrow(/verified committed parent lifecycle projection mismatch/);
      expect(await prisma.crawlObservation.count({where:{sourceResultId:"task3b-runtime-result-wrong-hash"}})).toBe(0);
      expect(await prisma.evidenceArtifact.count({where:{sourceResultId:"task3b-runtime-result-wrong-hash"}})).toBe(0);
      expect(await prisma.lifecycleSetEvidenceMember.count({where:{sourceResultId:"task3b-runtime-result-wrong-hash"}})).toBe(0);
      expect((await prisma.crawlBatchSourceResult.findUniqueOrThrow({where:{id:"task3b-runtime-result-wrong-hash"}})).atomicCommitState).toBe("PENDING");
      await prepare("task3b-runtime-grifols","task3b-runtime-result-grifols",grifolsSource);
      await expect(executeAtomicSourceEvidenceCommit(adapt(
        "task3b-runtime-grifols","task3b-runtime-result-grifols","grifols",grifolsVerifiedScopeExclusionCommit(),grifolsSource
      ),prisma as never)).resolves.toBeUndefined();
      expect((await prisma.crawlBatchSourceResult.findUniqueOrThrow({where:{id:"task3b-runtime-result-grifols"}})).atomicCommitState).toBe("COMMITTED");
      await prepare("task3b-runtime-roche","task3b-runtime-result-roche",rocheSource);
      await expect(executeAtomicSourceEvidenceCommit(adapt(
        "task3b-runtime-roche","task3b-runtime-result-roche","roche",
        rocheVerifiedOfficialTotalDedupeCommit(),rocheSource
      ),prisma as never)).resolves.toBeUndefined();
      expect((await prisma.crawlBatchSourceResult.findUniqueOrThrow({where:{id:"task3b-runtime-result-roche"}})).atomicCommitState).toBe("COMMITTED");
    }finally{await prisma.$disconnect()}
  });
});
