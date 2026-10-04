// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";

const migrationName = "20261003055000_jnj_dom_evidence_admission";
const sql = readFileSync(resolve("prisma/migrations", migrationName, "migration.sql"), "utf8");
const start = "        -- BEGIN EXACT JNJ DOM ADMISSION:";
const end = "        -- END EXACT JNJ DOM ADMISSION\n";
const exception = sql.slice(sql.indexOf(start), sql.indexOf(end) + end.length);
const predicate = exception.slice(exception.indexOf("            IF NOT (") + "            IF NOT (".length,
  exception.lastIndexOf("            ) IS TRUE THEN"));
const originalGate = `        IF official_artifact."kind" NOT IN ('OFFICIAL_COMPANY_PAGE', 'REDIRECT_TRACE', 'ATS_PAGE', 'ATS_API_RESPONSE', 'PAGINATION_PAGE') OR
           official_artifact."extractorLocator" IS NULL OR btrim(official_artifact."extractorLocator") = '' THEN
            RAISE EXCEPTION 'COMMITTED source result requires a located official network artifact';
        END IF;
`;
const sourceId = "source-johnson-innovative-medicine-social";
const companyId = "company-johnson-innovative-medicine";
const configHash = "80d9610e77965de2e15efba070735e77227c70efedb543d110bb259f75782cf3";
const listLocator = "jnj-ui-dom-list-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";
const detailLocator = "jnj-ui-dom-detail-v1|BROWSER_UI_DOM_OBSERVATION_NOT_HTTP";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
};

describe("exact JNJ DOM SQL47 candidate", () => {
  it("changes only the official-artifact admission branch of the actual SQL47 definition", () => {
    expect(sql.split(start)).toHaveLength(2);
    expect(sql.split(end)).toHaveLength(2);
    const restored = sql.replace(exception, originalGate);
    const definition = restored.slice(restored.indexOf("CREATE OR REPLACE FUNCTION"), restored.lastIndexOf("$function$")) + "$function$\n";
    expect(createHash("md5").update(definition).digest("hex")).toBe("0dc966770f95b8d593ea2404317287f3");
    const prior = readFileSync(resolve("prisma/migrations/20261002101515_organon_source_policy/migration.sql"), "utf8");
    expect(definition).toBe(prior.slice(prior.indexOf("CREATE OR REPLACE FUNCTION"), prior.lastIndexOf("$function$")) + "$function$\n");
    expect(definition).not.toContain("('source-lilly-china-social','company-lilly-china'");
  });

  it("uses a bounded, drift-guarded function replacement with no schema, registry, or ledger writes", () => {
    expect(sql).toContain("BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '30s';");
    expect(sql).toContain("IF md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) <> '0dc966770f95b8d593ea2404317287f3' THEN");
    expect(sql.indexOf("$guard$;")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION"));
    expect(sql.match(/CREATE OR REPLACE FUNCTION/gu)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(?:ALTER TABLE|ALTER TYPE|CREATE TABLE|CREATE TYPE|INSERT INTO|UPDATE\s+"|DELETE FROM)\b/u);
    expect(sql).not.toContain("_prisma_migrations");
    expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
  });

  it("pins the existing JNJ plan and retains fail-closed SQL NULL handling", () => {
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === sourceId)!;
    expect(plan.company.id).toBe(companyId);
    expect(sourcePlanConfigSha256(plan)).toBe(configHash);
    expect(predicate).toContain(`NEW."sourceConfigHash" = '${configHash}'`);
    expect(predicate).toContain(`source."companyId" = '${companyId}'`);
    expect(predicate).toContain('NEW."expectedJobCount" > 0');
    expect(predicate).toContain('pagination_count BETWEEN 1 AND 20');
    expect(predicate).toContain("< interval '30 minutes'");
    expect(exception).toContain(") IS TRUE THEN");
    expect(predicate.match(/\) IS NOT TRUE/gu)).toHaveLength(2);
    for (const field of ["requestedUrl", "finalUrl", "httpStatus", "contentType"]) {
      expect(predicate).toContain(`a."${field}" IS NULL`);
    }
  });
});

type Row = Record<string, unknown>;
type Receipt = { source: Row; result: Row; observation: Row; artifacts: Row[]; pages: Row[]; losses: Row[] };
const nextUrl = (page: number) => `https://www.careers.jnj.com/en/jobs/?page=${page}&country=China&origin=global#results`;
// Matches paginationEvidence.traceRecord / RepositoryPaginationDraft property order.
const repositoryTraceHash = (pages: Row[]) => hash(JSON.stringify([...pages]
  .sort((left, right) => Number(left.sequence) - Number(right.sequence))
  .map(page => ({
    artifactLogicalKey: `jnj-dom-list-${String(page.sequence).padStart(4, "0")}`,
    sequence: page.sequence, channelId: page.channelId ?? null,
    requestedCursor: page.requestedCursor ?? null, returnedCursor: page.returnedCursor ?? null,
    requestedOffset: page.requestedOffset ?? null, returnedOffset: page.returnedOffset ?? null,
    requestedPage: page.requestedPage ?? null, returnedPage: page.returnedPage ?? null,
    requestedPageSize: page.requestedPageSize ?? null, returnedPageSize: page.returnedPageSize ?? null,
    responseFingerprintSha256: page.responseFingerprintSha256,
    rawJobIdSetSha256: page.rawJobIdSetSha256, validJobIdSetSha256: page.validJobIdSetSha256,
    declaredTotal: page.declaredTotal ?? null, declaredCount: page.declaredCount ?? null,
    declaredPages: page.declaredPages ?? null, nextPageSignalBefore: page.nextPageSignalBefore ?? null,
    nextPageSignalAfter: page.nextPageSignalAfter ?? null, termination: page.termination,
    anomalyCodes: page.anomalyCodes, capturedAt: new Date(String(page.capturedAt)).toISOString()
  }))));
function fixture(): Receipt {
  const tuple = { releaseCandidateId: "rc-jnj", batchId: "batch-jnj", sourceId, sourceResultId: "result-jnj" };
  const artifact = (logicalKey: string, detail: boolean, capturedAt: string): Row => ({
    ...tuple, id: hash(logicalKey), path: `/archive/${hash(logicalKey)}--${logicalKey}.bin`,
    kind: "COMMAND_OUTPUT", captureToolName: "jnj-browser-ui-dom-observation", captureToolVersion: "1",
    extractorLocator: detail ? detailLocator : listLocator, sha256: hash(`original:${logicalKey}`), byteCount: 123,
    capturedAt
  });
  const lists = [0, 1].map(sequence => artifact(`jnj-dom-list-${String(sequence).padStart(4, "0")}`, false,
    `2026-10-03T05:01:0${sequence}.000Z`));
  const details = Array.from({ length: 21 }, (_, index) => artifact(`jnj-dom-detail-r-${100000 + index}`, true,
    "2026-10-03T05:00:01.000Z"));
  const pages = lists.map((a, sequence) => ({ ...tuple, id: `page-${sequence}`, artifactId: a.id,
    sequence, requestedPage: sequence + 1, returnedPage: sequence + 1, requestedOffset: sequence * 20,
    returnedOffset: sequence * 20, requestedPageSize: 20, returnedPageSize: 20, declaredTotal: 21,
    declaredCount: 21, declaredPages: 2, nextPageSignalBefore: sequence ? nextUrl(2) : null,
    nextPageSignalAfter: sequence ? null : nextUrl(2), termination: sequence ? "DECLARED_TOTAL_REACHED" : "CONTINUE",
    responseFingerprintSha256: a.sha256, rawJobIdSetSha256: hash(`page-${sequence}`),
    validJobIdSetSha256: hash(`page-${sequence}`), anomalyCodes: [], capturedAt: a.capturedAt }));
  const result: Row = { ...tuple, id: tuple.sourceResultId, sourceConfigHash: configHash, completenessState: "VERIFIED",
    expectedEvidenceKind: "OFFICIAL_TOTAL_COUNT", officialSurfaceIds: ["surface-johnson-innovative-medicine-social"],
    officialChannelIds: [`source:${sourceId}:default`], expectedJobCount: 21,
    rawCount: 21, parsedCount: 21, validCount: 21, normalizedCount: 21, dedupeInputCount: 21, dedupeOutputCount: 21,
    parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0, dedupeDiscardCount: 0,
    collisionCount: 0, discardCount: 0, adapterInputCount: 21, adapterOutputCount: 21, adapterLossCount: 0,
    adapterCollisionGroupCount: 0, canonicalCurrentJobSetSha256: hash("output"), canonicalOutputSetSha256: hash("output"),
    adapterReconciliationSha256: hash("reconciliation"), collisionLedgerSha256: hash("[]"),
    startedAt: "2026-10-03T05:00:00.000Z", finishedAt: "2026-10-03T05:02:00.000Z" };
  const observation: Row = { ...tuple, officialEvidenceArtifactId: lists[0]!.id, canonicalRawSha256: hash("raw"),
    paginationTraceSha256: hash("trace"), crawledAt: details[0]!.capturedAt, observedFrom: result.startedAt,
    observedTo: result.finishedAt, totalPages: 2, pageSize: 20 };
  result.completenessCertificate = {
    schemaVersion: "a-grade-official-total-v2", grade: "A",
    binding: { ...tuple, sourceConfigSha256: configHash },
    scope: { companyId, sourceId, recruitmentType: "SOCIAL", geography: "MAINLAND_CHINA", businessUnit: "ALL",
      verificationPolicy: "STRICT_PLAN_BOUND_OFFICIAL_TOTAL_REPLAY_V1", surfaceIds: result.officialSurfaceIds,
      channelIds: result.officialChannelIds },
    declaration: { kind: "OFFICIAL_TOTAL_COUNT", scope: "SOURCE", artifactLogicalKey: "jnj-dom-list-0000",
      artifactSha256: lists[0]!.sha256, extractorLocator: listLocator },
    counts: { officialTotal: 21, rawObservationCount: 21, rawUniqueOfficialRecordCount: 21, parsedCount: 21,
      validCount: 21, normalizedCount: 21, dedupeInputCount: 21, legalDedupeCount: 0, finalUniqueJobCount: 21,
      parseDiscardCount: 0, validationDiscardCount: 0, normalizationDiscardCount: 0 },
    legalDedupeLedger: [], legalScopeExclusionLedger: [],
    pagination: { pageCount: 2, paginationTraceSha256: repositoryTraceHash(pages),
      canonicalRawOfficialIdSetSha256: observation.canonicalRawSha256 },
    output: { canonicalJobSetSha256: result.canonicalCurrentJobSetSha256,
      adapterReconciliationSha256: result.adapterReconciliationSha256, collisionLedgerSha256: result.collisionLedgerSha256 },
    observedAt: lists[0]!.capturedAt
  };
  result.completenessCertificateSha256 = hash(canonical(result.completenessCertificate));
  return { source: { id: sourceId, companyId, kind: "SOCIAL" }, result, observation, artifacts: [...lists, ...details], pages, losses: [] };
}

// Existing opt-in PostgreSQL-WASM runtime. Every query below is SELECT-only, all state is in memory.
const modulePath = process.env.PGLITE_MODULE;
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gmu)].map(match => match[1]));
const records = (name: string, parameter: number): string => {
  const body = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))![1]!;
  const types: Record<string, string> = { String: "text", Int: "integer", DateTime: "timestamp", Boolean: "boolean", Json: "jsonb" };
  const columns = [...body.matchAll(/^\s+(\w+)\s+(\w+)(\[\]|\?)?/gmu)].flatMap(([, key, type, suffix]) => {
    const sqlType = types[type!] ?? (enums.has(type) ? "text" : undefined);
    return sqlType ? [`"${key}" ${sqlType}${suffix === "[]" ? "[]" : ""}`] : [];
  });
  return `SELECT * FROM jsonb_to_recordset($${parameter}::jsonb) AS r(${columns.join(", ")})`;
};
const query = `WITH "RecruitmentSource" AS (${records("RecruitmentSource", 1)}),
  "EvidenceArtifact" AS (${records("EvidenceArtifact", 2)}),
  "PaginationEvidence" AS (${records("PaginationEvidence", 3)}),
  "LossLedgerEntry" AS (${records("LossLedgerEntry", 4)}),
  NEW AS (${records("CrawlBatchSourceResult", 5)}), observation AS (${records("CrawlObservation", 6)}),
  official_artifact AS (SELECT * FROM "EvidenceArtifact" WHERE "id" = (SELECT "officialEvidenceArtifactId" FROM observation))
  SELECT (${predicate}) IS TRUE AS admitted FROM NEW CROSS JOIN observation CROSS JOIN official_artifact
  CROSS JOIN LATERAL (SELECT NEW."completenessCertificate" AS quality,
    (SELECT count(*) FROM "PaginationEvidence" WHERE "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId"
      AND "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId") AS pagination_count) vars`;

describe.skipIf(!modulePath)("JNJ DOM predicate in real PostgreSQL SELECT-only execution", () => {
  let db: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ admitted: boolean }> }>; close: () => Promise<void> };
  beforeAll(async () => {
    const { PGlite } = createRequire(import.meta.url)(modulePath!.replace(/\.js$/u, ".cjs"));
    db = new PGlite();
  });
  afterAll(async () => { await db?.close(); });
  const admitted = async (receipt: Receipt) => (await db.query(query, [
    [receipt.source], receipt.artifacts, receipt.pages, receipt.losses, [receipt.result], [receipt.observation]
  ].map(value => JSON.stringify(value)))).rows[0]!.admitted;
  it("accepts complete exact-source original DOM observations with a valid canonical A hash", async () => {
    expect(await admitted(fixture())).toBe(true);
  }, 30_000);

  it.skipIf(!process.env.JNJ_DOM_RUNTIME_COMMIT_JSON)("admits the actual runtime-generated JNJ atomic commit after ingestion field mapping", async () => {
    const commit = JSON.parse(readFileSync(process.env.JNJ_DOM_RUNTIME_COMMIT_JSON!, "utf8")) as {
      sourceResult: Row; observationProvenance: Row; artifacts: Row[]; pagination: Row[]; lossLedger: Row[];
      commands: Array<{ type: string; observation?: Row }>;
    };
    const command = commit.commands.find(item => item.type === "UPSERT_CRAWL_OBSERVATION");
    expect(command?.observation).toBeDefined();
    const observation = command!.observation!;
    const artifactsByLogicalKey = new Map(commit.artifacts.map(artifact => [artifact.logicalKey, artifact]));
    const officialArtifact = artifactsByLogicalKey.get(commit.observationProvenance.officialEvidenceArtifactLogicalKey);
    expect(officialArtifact).toBeDefined();
    // Mirrors ingestionRepository's OBSERVATION_WRITE and PAGINATION_WRITE mappings.
    // No count, capture time, certificate, or optional totalPages value is repaired here.
    const mappedObservation: Row = {
      ...observation, ...commit.observationProvenance,
      sourceResultId: commit.sourceResult.id, sourceId: commit.sourceResult.sourceId,
      batchId: commit.sourceResult.batchId, releaseCandidateId: commit.sourceResult.releaseCandidateId,
      officialEvidenceArtifactId: officialArtifact!.id,
      totalPages: observation.totalPages ?? null, pageSize: observation.pageSize ?? null,
      pagesVisited: observation.pagesVisited ?? null
    };
    for (const key of ["rawCount", "parsedCount", "validCount", "normalizedCount", "dedupeInputCount",
      "dedupeOutputCount", "parseDiscardCount", "validationDiscardCount", "normalizationDiscardCount",
      "dedupeDiscardCount", "discardCount", "collisionCount", "expectedJobCount"]) {
      mappedObservation[key] = commit.sourceResult[key];
    }
    const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(item => item.source.id === commit.sourceResult.sourceId)!;
    const receipt: Receipt = {
      source: { id: plan.source.id, companyId: plan.company.id, kind: plan.source.kind },
      result: commit.sourceResult, observation: mappedObservation, artifacts: commit.artifacts,
      pages: commit.pagination.map(page => {
        const artifact = artifactsByLogicalKey.get(page.artifactLogicalKey);
        expect(artifact).toBeDefined();
        return { ...page, artifactId: artifact!.id };
      }), losses: commit.lossLedger
    };
    expect(receipt.result.sourceId).toBe(sourceId);
    expect(receipt.result.sourceConfigHash).toBe(configHash);
    expect(receipt.observation.pagesVisited).toBe(receipt.pages.length);
    expect(((receipt.result.completenessCertificate as Row).pagination as Row).paginationTraceSha256)
      .toBe(repositoryTraceHash(receipt.pages));
    expect(await admitted(receipt)).toBe(true);
  });

  it("preserves the existing optional observation totalPages while page trace counts remain bound", async () => {
    const receipt = fixture(); delete receipt.observation.totalPages;
    expect(await admitted(receipt)).toBe(true);
  });

  it("admits an original capture span just below 30 minutes", async () => {
    const receipt = fixture();
    receipt.artifacts.at(-1)!.capturedAt = "2026-10-03T05:30:00.999Z";
    receipt.result.finishedAt = "2026-10-03T05:31:00.000Z";
    receipt.observation.observedTo = receipt.result.finishedAt;
    expect(await admitted(receipt)).toBe(true);
  });

  const canonicalSql = predicate.slice(predicate.indexOf("WITH RECURSIVE nodes"),
    predicate.indexOf("                ) AND\n                pagination_count"));
  it.each([
    ["nested empty containers", { z: [], a: {}, nested: { b: [[], {}, null, true, false, 21], a: "value" } }],
    ["UTF-8 key ordering", { "中": "汉字", "ä": "accent", "a": "ascii", "😀": "emoji" }],
    ["escaped JSON strings", { quote: '\"', slash: "a/b", backslash: "a\\b", newline: "line\nnext", tab: "\t" }]
  ])("recomputes canonical SHA-256 with %s", async (_label, value) => {
    const result = await db.query(`SELECT (${canonicalSql.replace("SELECT quality,", "SELECT $1::jsonb,")}) = $2 AS admitted`,
      [JSON.stringify(value), hash(canonical(value))]);
    expect(result.rows[0]!.admitted).toBe(true);
  });

  const cases: Array<[string, (r: Receipt) => void]> = [
    ["another source", r => { r.result.sourceId = "source-lilly-china-social"; }],
    ["another company", r => { r.source.companyId = "company-lilly-china"; }],
    ["changed config", r => { r.result.sourceConfigHash = hash("changed"); }],
    ["missing config", r => { delete r.result.sourceConfigHash; }],
    ["unverified completeness", r => { r.result.completenessState = "INCOMPLETE"; }],
    ["wrong evidence kind", r => { r.result.expectedEvidenceKind = "PAGINATION_EXHAUSTED"; }],
    ["lossy accounting", r => { r.result.validationDiscardCount = 1; }],
    ["missing accounting", r => { delete r.result.rawCount; }],
    ["unexpected loss ledger", r => { r.losses.push({ sourceResultId: r.result.id }); }],
    ["wrong capture tool", r => { r.artifacts[0]!.captureToolName = "jnj-careers-html"; }],
    ["wrong tool version", r => { r.artifacts[0]!.captureToolVersion = "2"; }],
    ["generic command artifact", r => { r.artifacts[0]!.extractorLocator = "command-output"; }],
    ["forged official network kind", r => { r.artifacts[0]!.kind = "PAGINATION_PAGE"; }],
    ...["requestedUrl", "finalUrl", "httpStatus", "contentType"].map(field => [
      `HTTP field ${field}`, (r: Receipt) => { r.artifacts[2]![field] = field === "httpStatus" ? 200 : field === "contentType" ? "application/json" : "https://www.careers.jnj.com/"; }
    ] as [string, (r: Receipt) => void]),
    ["tampered certificate hash", r => { r.result.completenessCertificateSha256 = hash("tampered"); }],
    ["mutated certificate without rehash", r => { (r.result.completenessCertificate as Row).observedAt = "2026-10-03T06:00:00.000Z"; }],
    ["wrong certificate binding even after rehash", r => {
      ((r.result.completenessCertificate as Row).binding as Row).batchId = "other";
      r.result.completenessCertificateSha256 = hash(canonical(r.result.completenessCertificate));
    }],
    ["unknown certificate field even after rehash", r => {
      (r.result.completenessCertificate as Row).unreviewed = true;
      r.result.completenessCertificateSha256 = hash(canonical(r.result.completenessCertificate));
    }],
    ["certificate scope drift even after rehash", r => {
      ((r.result.completenessCertificate as Row).scope as Row).businessUnit = "INNOVATIVE_MEDICINE";
      r.result.completenessCertificateSha256 = hash(canonical(r.result.completenessCertificate));
    }],
    ["certificate output drift even after rehash", r => {
      ((r.result.completenessCertificate as Row).output as Row).canonicalJobSetSha256 = hash("other");
      r.result.completenessCertificateSha256 = hash(canonical(r.result.completenessCertificate));
    }],
    ["missing detail", r => { r.artifacts.pop(); }],
    ["duplicate detail logical key", r => { r.artifacts.at(-1)!.path = r.artifacts.at(-2)!.path; }],
    ["detail from another tuple", r => { r.artifacts[2]!.batchId = "other"; }],
    ["detail outside original acquisition window", r => { r.artifacts[2]!.capturedAt = "2026-10-03T04:59:59.000Z"; }],
    ["rewritten observation time", r => { r.observation.crawledAt = r.result.finishedAt; }],
    ["page from another tuple", r => { r.pages[0]!.batchId = "other"; }],
    ["page references a detail", r => { r.pages[0]!.artifactId = r.artifacts[2]!.id; }],
    ["missing page", r => { r.pages.pop(); }],
    ["duplicate page artifact", r => { r.pages[1]!.artifactId = r.pages[0]!.artifactId; }],
    ["noncontiguous page", r => { r.pages[1]!.sequence = 2; }],
    ["page total drift", r => { r.pages[1]!.declaredTotal = 22; }],
    ["unsafe termination", r => { r.pages[1]!.termination = "MAX_PAGE_LIMIT"; }],
    ["page anomaly", r => { r.pages[1]!.anomalyCodes = ["TOTAL_CHANGED"]; }],
    ["page hash mismatch", r => { r.pages[1]!.responseFingerprintSha256 = hash("other"); }],
    ["page capture time mismatch", r => { r.pages[1]!.capturedAt = r.pages[0]!.capturedAt; }],
    ["synthetic next signal", r => { r.pages[0]!.nextPageSignalAfter = "page:2"; }],
    ["mismatched optional page count", r => { r.observation.totalPages = 3; }],
    ["total beyond the source's 400-job bound", r => { r.result.expectedJobCount = 401; }],
    ["original capture span reaching 30 minutes", r => {
      r.artifacts.at(-1)!.capturedAt = "2026-10-03T05:30:01.000Z";
      r.result.finishedAt = "2026-10-03T05:31:00.000Z";
      r.observation.observedTo = r.result.finishedAt;
    }]
  ];
  it.each(cases)("rejects %s", async (_name, mutate) => {
    const receipt = fixture(); mutate(receipt); expect(await admitted(receipt)).toBe(false);
  });
});
