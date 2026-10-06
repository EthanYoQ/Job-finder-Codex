import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { PGlite } from "./dependencies/node_modules/@electric-sql/pglite/dist/index.js";
import { syntheticJnjCommit } from "../jnj-native-url-candidate-20261006T0713Z/tests/helpers/jnjNativeSyntheticFixture";
const candidateRoot=resolve("../jnj-native-url-candidate-20261006T0713Z");
const oldSql=readFileSync(resolve(candidateRoot,"prisma/migrations/20261003055000_jnj_dom_evidence_admission/migration.sql"),"utf8");
const newSql=readFileSync(resolve(candidateRoot,"prisma/migrations/20261006071300_jnj_native_url_profile/migration.sql"),"utf8");
function predicateOf(sql:string) {
 const start="        -- BEGIN EXACT JNJ DOM ADMISSION:",end="        -- END EXACT JNJ DOM ADMISSION\n";
 const section=sql.slice(sql.indexOf(start),sql.indexOf(end)+end.length);
 return section.slice(section.indexOf("            IF NOT (")+"            IF NOT (".length,section.lastIndexOf("            ) IS TRUE THEN"));
}
const oldPredicate=predicateOf(oldSql),newPredicate=predicateOf(newSql);
const functionOf=(sql:string)=>sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION"),sql.lastIndexOf("$function$"))+"$function$\n";
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

const schema = readFileSync(resolve(candidateRoot,"prisma/schema.prisma"), "utf8");
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
const makeQuery = (predicate: string) => `WITH "RecruitmentSource" AS (${records("RecruitmentSource", 1)}),
  "EvidenceArtifact" AS (${records("EvidenceArtifact", 2)}),
  "PaginationEvidence" AS (${records("PaginationEvidence", 3)}),
  "LossLedgerEntry" AS (${records("LossLedgerEntry", 4)}),
  NEW AS (${records("CrawlBatchSourceResult", 5)}), observation AS (${records("CrawlObservation", 6)}),
  official_artifact AS (SELECT * FROM "EvidenceArtifact" WHERE "id" = (SELECT "officialEvidenceArtifactId" FROM observation))
  SELECT (${predicate}) IS TRUE AS admitted FROM NEW CROSS JOIN observation CROSS JOIN official_artifact
  CROSS JOIN LATERAL (SELECT NEW."completenessCertificate" AS quality,
    (SELECT count(*) FROM "PaginationEvidence" WHERE "sourceResultId" = NEW."id" AND "releaseCandidateId" = NEW."releaseCandidateId"
      AND "batchId" = NEW."batchId" AND "sourceId" = NEW."sourceId") AS pagination_count) vars`;

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
    ["unknown tool version", r => { r.artifacts[0]!.captureToolVersion = "3"; }],
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

const db=new PGlite(),results: Array<{name:string,status:"PASS"|"FAIL",detail?:unknown}>=[];
async function check(name:string,work:()=>Promise<void>) {try {await work();results.push({name,status:"PASS"});}catch(error){results.push({name,status:"FAIL",detail:String(error)});}}
const admitted=async(receipt:Receipt,predicate=newPredicate) => (await db.query<{admitted:boolean}>(makeQuery(predicate),[
 [receipt.source],receipt.artifacts,receipt.pages,receipt.losses,[receipt.result],[receipt.observation]
].map(v=>JSON.stringify(v)))).rows[0]!.admitted;
function rehash(r:Receipt) {
 const certificate=r.result.completenessCertificate as Row;
 (certificate.pagination as Row).paginationTraceSha256=repositoryTraceHash(r.pages);
 r.result.completenessCertificateSha256=hash(canonical(certificate));
}
function profiled(version:"1"|"2"):Receipt {
 const r=fixture();for(const a of r.artifacts)a.captureToolVersion=version;
 if(version==="2")for(const p of r.pages)for(const key of ["nextPageSignalBefore","nextPageSignalAfter"])if(typeof p[key]==="string")p[key]=(p[key] as string).replace("origin=global","pagesize=20");
 rehash(r);return r;
}
const runtime=await db.query("SELECT version() AS version, current_setting('server_version') AS server_version");
writeFileSync("POSTGRES_RUNTIME.json",JSON.stringify(runtime.rows,null,2)+"\n");
await check("old exact SQL48 predicate admits legacy fixture",async()=>assert.equal(await admitted(profiled("1"),oldPredicate),true));
await check("old exact SQL48 predicate rejects native fixture",async()=>assert.equal(await admitted(profiled("2"),oldPredicate),false));
for(const version of ["1","2"] as const) {
 await check(`profile ${version}: accepts NULL optional totalPages`,async()=>{const r=profiled(version);r.observation.totalPages=null;assert.equal(await admitted(r),true);});
 await check(`profile ${version}: accepts span just below 30 minutes`,async()=>{const r=profiled(version);r.artifacts.at(-1)!.capturedAt="2026-10-03T05:30:00.999Z";r.result.finishedAt="2026-10-03T05:31:00.000Z";r.observation.observedTo=r.result.finishedAt;assert.equal(await admitted(r),true);});
 await check(`new predicate admits homogeneous profile ${version}`,async()=>assert.equal(await admitted(profiled(version)),true));
 for(const [name,mutate] of cases)await check(`profile ${version}: ${name}`,async()=>{const r=profiled(version);mutate(r);assert.equal(await admitted(r),false);});
}
const strictCases:Array<[string,(r:Receipt)=>void]>=[
 ["mixed list capture version",r=>r.artifacts[1]!.captureToolVersion="1"],
 ["mixed detail capture version",r=>r.artifacts[2]!.captureToolVersion="1"],
 ["all v1 artifact versions with native signals",r=>r.artifacts.forEach(a=>a.captureToolVersion="1")],
 ["one old-origin next link",r=>r.pages[0]!.nextPageSignalAfter=nextUrl(2)],
 ["one old-origin before link",r=>r.pages[1]!.nextPageSignalBefore=nextUrl(2)],
 ["wrong Next 79",r=>r.pages[0]!.nextPageSignalAfter=(r.pages[0]!.nextPageSignalAfter as string).replace("page=2","page=79")],
 ["wrong preceding page number",r=>r.pages[1]!.nextPageSignalBefore=(r.pages[1]!.nextPageSignalBefore as string).replace("page=2","page=1")],
 ["page size 100 URL",r=>r.pages[0]!.nextPageSignalAfter=(r.pages[0]!.nextPageSignalAfter as string).replace("pagesize=20","pagesize=100")],
 ["country Japan URL",r=>r.pages[0]!.nextPageSignalAfter=(r.pages[0]!.nextPageSignalAfter as string).replace("China","Japan")],
 ["duplicate country URL",r=>r.pages[0]!.nextPageSignalAfter=(r.pages[0]!.nextPageSignalAfter as string).replace("#results","&country=China#results")],
 ["unknown tool version",r=>r.artifacts.forEach(a=>a.captureToolVersion="3")],
 ["NULL official capture version",r=>r.artifacts[0]!.captureToolVersion=null],
 ["NULL detail capture version",r=>r.artifacts[2]!.captureToolVersion=null],
 ["NULL official tool name",r=>r.artifacts[0]!.captureToolName=null],
 ["NULL interior next signal",r=>r.pages[0]!.nextPageSignalAfter=null],
 ["NULL interior before signal",r=>r.pages[1]!.nextPageSignalBefore=null],
 ["NULL page source",r=>r.pages[0]!.sourceId=null],
 ["NULL page size",r=>r.pages[0]!.requestedPageSize=null],
 ["NULL source configuration",r=>r.result.sourceConfigHash=null],
 ["NULL certificate",r=>r.result.completenessCertificate=null]
];
for(const [name,mutate] of strictCases)await check(`rehash-resistant native rejection: ${name}`,async()=>{
 const r=profiled("2");mutate(r);if(r.result.completenessCertificate!==null)rehash(r);assert.equal(await admitted(r),false);
});
for(const profile of ["legacy-origin-global-v1","native-pagesize20-v2"] as const)for(const total of [1,21,106]) {
 await check(`actual synthetic runtime commit: ${profile}, ${total} jobs`,async()=>{
  const {commit,plan}=await syntheticJnjCommit(profile,total);
  const observationCommand=commit.commands.find(c=>c.type==="UPSERT_CRAWL_OBSERVATION")!;
  assert.equal(observationCommand.type,"UPSERT_CRAWL_OBSERVATION");
  const artifactsByLogicalKey=new Map(commit.artifacts.map(a=>[a.logicalKey,a]));
  const official=artifactsByLogicalKey.get(commit.observationProvenance.officialEvidenceArtifactLogicalKey!)!;
  const observation:Row={...observationCommand.observation,...commit.observationProvenance,
   sourceResultId:commit.sourceResult.id,sourceId:commit.sourceResult.sourceId,batchId:commit.sourceResult.batchId,releaseCandidateId:commit.sourceResult.releaseCandidateId,
   officialEvidenceArtifactId:official.id,totalPages:observationCommand.observation.totalPages??null,pageSize:observationCommand.observation.pageSize??null,pagesVisited:observationCommand.observation.pagesVisited??null};
  for(const key of ["rawCount","parsedCount","validCount","normalizedCount","dedupeInputCount","dedupeOutputCount","parseDiscardCount","validationDiscardCount","normalizationDiscardCount","dedupeDiscardCount","discardCount","collisionCount","expectedJobCount"])observation[key]=(commit.sourceResult as any)[key];
  const r:Receipt={source:{id:plan.source.id,companyId:plan.company.id,kind:plan.source.kind},result:commit.sourceResult as unknown as Row,observation,artifacts:commit.artifacts as unknown as Row[],pages:commit.pagination.map(p=>({...p,artifactId:artifactsByLogicalKey.get(p.artifactLogicalKey)!.id})),losses:commit.lossLedger as unknown as Row[]};
  assert.equal(await admitted(r),true);
  assert.equal(await admitted(r,oldPredicate),profile==="legacy-origin-global-v1");
  if(total===106&&profile==="native-pagesize20-v2") {
   r.pages[1]!.nextPageSignalAfter="https://www.careers.jnj.com/en/jobs/?page=2&country=China&pagesize=20#results";rehash(r);assert.equal(await admitted(r),false);
  }
 });
}
await check("compile complete SQL48 PL/pgSQL function body in disposable local PostgreSQL",async()=>{
 await db.exec(functionOf(oldSql)+";");
 const actual=await db.query<{md5:string}>("SELECT md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) AS md5");
 assert.equal(actual.rows[0]!.md5,"8fd00ed15932e3101eec3908ac3f33f3");
});
await check("run exact new transaction/guard/function wrapper against local SQL48 identity",async()=>{
 await db.exec(newSql);
 const actual=await db.query<{md5:string}>("SELECT md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) AS md5");
 assert.equal(actual.rows[0]!.md5,"8e8689ef678c20f1fc34cb665dcf0def");
});
await check("new migration refuses a non-SQL48 prior identity without changing function",async()=>{
 await assert.rejects(db.exec(newSql),/Source policy drift before exact JNJ native URL profile admission/);
 await db.exec("ROLLBACK");
 const actual=await db.query<{md5:string}>("SELECT md5(pg_get_functiondef('public.enforce_source_result_state_machine()'::regprocedure)) AS md5");
 assert.equal(actual.rows[0]!.md5,"8e8689ef678c20f1fc34cb665dcf0def");
});
await db.close();
const report={kind:"LOCAL_POSTGRES_WASM_SYNTHETIC_PREDICATE_AND_FUNCTION_WRAPPER_TEST_NOT_PRODUCTION_TRIGGER_QUALIFICATION",package:"@electric-sql/pglite",version:"0.3.14",postgres:runtime.rows,
 oldSqlSha256:hash(oldSql),newSqlSha256:hash(newSql),oldPredicateSha256:hash(oldPredicate),newPredicateSha256:hash(newPredicate),
 scope:{exactPredicatesExecuted:true,syntheticRuntimeCommits:true,fullFunctionCompiled:true,wrapperExecutedInDisposableMemory:true,fullTriggerRowTransitionExecuted:false,productionDatabaseAccessed:false,realCaptureRead:false,frozenCandidateModified:false},
 passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,results};
writeFileSync("POSTGRES_TEST_RESULTS.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({passed:report.passed,failed:report.failed,postgres:runtime.rows,failures:results.filter(x=>x.status==="FAIL")},null,2));
if(report.failed)process.exitCode=1;
