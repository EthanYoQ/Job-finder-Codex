import { createHash } from "node:crypto";

export interface Phase2AggregateManifest {
  schemaVersion: "phase2-aggregate-freeze-v1";
  rcId: string;
  goalId: string;
  capturedAt: string;
  git: { head: string; commitBound: false; dirtyStatusSha256: string; dirtyEntryCount: number; boundary: string };
  roster: { foreign: 30; domestic: 30; total: 60; rosterSha256: string; mappingSha256: string; provenance: unknown };
  contract: { sourceSha256: string; testSha256: string; aggregateValidatorSha256: string; aggregateTestSha256: string };
  batches: Array<{ batchId: "F01" | "F02" | "D01" | "D02"; path: string; bytes: number; physicalSha256: string;
    semanticSha256: string; captureStartedAt: string; captureCompletedAt: string; companyCount: 15; surfaceCount: number; channelCount: number;
    surfaceStatuses: Record<"PENDING" | "BLOCKED" | "EXCLUDED", number>;
    channelStatuses: Record<"PENDING" | "UNRESOLVED", number>;
    promotionCount: 0; activeCount: 0 }>;
  merged: { companyCount: 60; semanticSha256: string };
  qaReports: Array<{ id: string; batchId?: "F01" | "F02" | "D01" | "D02"; path: string; bytes: number;
    physicalSha256: string; decision: "FINAL_BOUNDED_PASS"; capturedAt: string; companionRaw?: string;
    originalReport?: { path: string; bytes: number; physicalSha256: string } }>;
  boundaries: { tavily: "DISCOVERY_ONLY_NOT_OFFICIAL_CHAIN_OR_PRODUCTION_EVIDENCE"; database: "NOT_ACCESSED";
    crawl: "NOT_RUN"; promotion: "ZERO"; releaseClaim: false };
  integrity: { contentSha256: string };
}

export function phase2ManifestContentHash(value: Omit<Phase2AggregateManifest, "integrity">): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function validatePhase2AggregateManifest(value: Phase2AggregateManifest, now: Date): string[] {
  const errors: string[] = [];
  let aggregateTime: bigint;
  try {
    aggregateTime = parseStrictZonedIso100ns(value.capturedAt);
    if (!Number.isFinite(now.getTime()) || aggregateTime > BigInt(now.getTime()) * 10_000n) errors.push("AGGREGATE_CAPTURE_FUTURE");
  } catch { aggregateTime = -1n; errors.push("AGGREGATE_CAPTURE_INVALID"); }
  const expected = ["F01", "F02", "D01", "D02"];
  if (value.rcId !== "p0-rc-20260710-001") errors.push("RC_MISMATCH");
  if (value.git.commitBound !== false || value.boundaries.releaseClaim !== false) errors.push("RELEASE_BOUNDARY_INVALID");
  if (value.roster.foreign !== 30 || value.roster.domestic !== 30 || value.roster.total !== 60) errors.push("ROSTER_COUNT_INVALID");
  if (value.batches.length !== 4 || new Set(value.batches.map((batch) => batch.batchId)).size !== 4 ||
      !expected.every((id) => value.batches.some((batch) => batch.batchId === id))) errors.push("BATCH_PARTITION_INVALID");
  if (value.batches.some((batch) => batch.companyCount !== 15 || batch.promotionCount !== 0 || batch.activeCount !== 0 ||
      Object.values(batch.surfaceStatuses).reduce((sum, count) => sum + count, 0) !== batch.surfaceCount ||
      Object.values(batch.channelStatuses).reduce((sum, count) => sum + count, 0) !== batch.channelCount ||
      batch.bytes <= 0 || !isSha(batch.physicalSha256) || !isSha(batch.semanticSha256))) errors.push("BATCH_FACT_INVALID");
  if (value.merged.companyCount !== 60 || value.merged.semanticSha256 !== "3c923978d92d576674b49fe6b721e83dd58367b7a2d3ff0fd91d31598b62c51b") errors.push("MERGED_HASH_INVALID");
  for (const batch of value.batches) {
    const reports = value.qaReports.filter((report) => report.batchId === batch.batchId);
    if (reports.length !== 1) errors.push(`QA_REPORT_${batch.batchId}_MISSING_OR_DUPLICATE`);
    const report = reports[0];
    if (report) {
      try {
        if (typeof report.companionRaw !== "string" || Buffer.byteLength(report.companionRaw) !== report.bytes ||
            createHash("sha256").update(report.companionRaw).digest("hex") !== report.physicalSha256) throw new Error("companion physical");
        const binding = parseCurrentBindingCompanion(JSON.parse(report.companionRaw), batch.batchId);
        const batchStartTime = parseStrictZonedIso100ns(batch.captureStartedAt);
        const batchTime = parseStrictZonedIso100ns(batch.captureCompletedAt);
        const companionTime = parseStrictZonedIso100ns(binding.capturedAt);
        if (report.decision !== "FINAL_BOUNDED_PASS" || binding.semanticSha256 !== batch.semanticSha256 ||
            binding.physicalSha256 !== batch.physicalSha256 || binding.bytes !== batch.bytes || binding.promotionCount !== 0 ||
            binding.mergedSha256 !== value.merged.semanticSha256 || binding.companyCount !== 15 ||
            binding.capturedAt !== report.capturedAt || batchStartTime > batchTime || companionTime < batchTime || companionTime > aggregateTime || aggregateTime > BigInt(now.getTime()) * 10_000n ||
            (binding.originalReportCapturedAt !== undefined && parseStrictZonedIso100ns(binding.originalReportCapturedAt) > companionTime) ||
            Object.entries(binding.allSemantic).some(([id, hash]) =>
              value.batches.find((candidate) => candidate.batchId === id)?.semanticSha256 !== hash) ||
            !report.originalReport || binding.originalReportSha256 !== report.originalReport.physicalSha256 ||
            (binding.originalReportBytes !== undefined && binding.originalReportBytes !== report.originalReport.bytes) ||
            (binding.originalReportPath !== undefined && !binding.originalReportPath.endsWith(report.originalReport.path))) {
          errors.push(`QA_REPORT_${batch.batchId}_STALE_OR_MISMATCHED`);
        }
      } catch { errors.push(`QA_REPORT_${batch.batchId}_SCHEMA_INVALID`); }
    }
  }
  if (new Set(value.qaReports.map((report) => report.id)).size !== value.qaReports.length ||
      value.qaReports.some((report) => report.bytes <= 0 || !isSha(report.physicalSha256))) errors.push("QA_REPORT_INVALID");
  const { integrity: _integrity, ...content } = value;
  if (value.integrity.contentSha256 !== phase2ManifestContentHash(content)) errors.push("SELF_HASH_MISMATCH");
  return errors;
}

interface NormalizedBinding { capturedAt: string; semanticSha256: string; physicalSha256: string; bytes: number;
  companyCount: number; promotionCount: number; allSemantic: Record<string, string>; mergedSha256: string; originalReportSha256: string;
  originalReportBytes?: number; originalReportPath?: string; originalReportCapturedAt?: string }

export function parseCurrentBindingCompanion(value: unknown, expectedBatchId: "F01" | "F02" | "D01" | "D02"): NormalizedBinding {
  const root = record(value); if (root.batchId !== expectedBatchId) throw new Error("batch");
  if (expectedBatchId === "F01") {
    exact(root, ["schemaVersion","rcId","batchId","capturedAt","decision","severity","currentF01","originalFinalQa","currentBatchSemanticHashes","currentMerge","mutationPerformed"]);
    if (root.schemaVersion !== "phase2-task2-f01-current-binding-companion-v1" || root.decision !== "PASS_CURRENT_HASH_BOUND" || root.mutationPerformed !== false) throw new Error("decision");
    severity(root.severity, "p0", "p1"); const current = exactRecord(root.currentF01, ["physicalSha256","bytes","semanticSha256","companyCount","promotionCount","oracleStatus"]);
    const original = exactRecord(root.originalFinalQa, ["reportSha256","findingsSha256","decision","severity","semanticHashMatchesCurrent"]);
    severity(original.severity, "p0", "p1"); if (original.decision !== "FINAL_BOUNDED_PASS" || original.semanticHashMatchesCurrent !== true) throw new Error("final");
    const merge = exactRecord(root.currentMerge, ["semanticSha256","companyCount","run1Ok","run2Ok","deterministic"]);
    if (merge.companyCount !== 60 || merge.run1Ok !== true || merge.run2Ok !== true || merge.deterministic !== true) throw new Error("merge");
    return normalized(root, current, root.currentBatchSemanticHashes, merge.semanticSha256, original.reportSha256);
  }
  if (expectedBatchId === "F02") {
    exact(root, ["schemaVersion","batchId","capturedAt","decision","severityCounts","currentF02","semanticPartitions","merge","singleValidation","boundFinalReport","boundary"]);
    if (root.schemaVersion !== "phase2-task2-current-binding-companion-v1" || root.decision !== "PASS") throw new Error("decision");
    severity(root.severityCounts, "P0", "P1"); const current = exactRecord(root.currentF02, ["path","semanticSha256","physicalSha256","bytes","companyCount","promotionCount","oracleStatus"]);
    const merge = exactRecord(root.merge, ["companyCount","semanticSha256","run1Ok","run2Ok","identicalAcrossRuns"]);
    const single = exactRecord(root.singleValidation, ["run1Ok","run2Ok","identicalAcrossRuns"]);
    const final = exactRecord(root.boundFinalReport, ["markdownPath","markdownSha256","jsonPath","jsonSha256","decision","severityCounts"]);
    severity(final.severityCounts,"P0","P1"); if (final.decision !== "PASS" || !allTrue(merge,"run1Ok","run2Ok","identicalAcrossRuns") || !allTrue(single,"run1Ok","run2Ok","identicalAcrossRuns")) throw new Error("final");
    return normalized(root, current, root.semanticPartitions, merge.semanticSha256, final.markdownSha256, undefined, String(final.markdownPath));
  }
  if (expectedBatchId === "D01") {
    exact(root, ["schemaVersion","rcId","batchId","capturedAt","decision","severity","readOnly","boundFinalDecision","d01","currentFourBatch","boundFinalQa","boundary","finalStatement"]);
    if (root.schemaVersion !== "phase2-task2-current-binding-companion-v1" || root.decision !== "CURRENT_BINDING_PASS" || root.readOnly !== true || root.boundFinalDecision !== "FINAL_BOUNDED_PASS") throw new Error("decision");
    severity(root.severity,"p0","p1"); const current = exactRecord(root.d01,["path","bytes","physicalSha256","semanticSha256","singleValidationOk","singleMerge","companies","surfaces","oracleStatus","promotionCount"]);
    const merge = exactRecord(root.currentFourBatch,["validationOk","runs","stable","companyCount","semanticSha256ByBatch","mergedSemanticSha256"]);
    const final = exactRecord(root.boundFinalQa,["markdown","json"]); const md = exactRecord(final.markdown,["path","bytes","physicalSha256"]); exactRecord(final.json,["path","bytes","physicalSha256"]);
    exactRecord(root.boundary,["promotion","jobCompleteness","crawlAuthorized","mutationAuthorized","releaseReadiness"]);
    if (current.singleValidationOk !== true || merge.validationOk !== true || merge.runs !== 2 || merge.stable !== true || merge.companyCount !== 60) throw new Error("merge");
    return normalized(root,{...current,companyCount:current.companies},merge.semanticSha256ByBatch,merge.mergedSemanticSha256,md.physicalSha256,Number(md.bytes),String(md.path));
  }
  exact(root,["schemaVersion","rcId","batchId","capturedAt","decision","severity","preservedFinalReport","currentCanonicalBindings","d02CurrentState","mergeRuns","integrity"]);
  if (root.schemaVersion !== "phase2-task2-d02-current-binding-companion-v1" || root.decision !== "PASS") throw new Error("decision"); severity(root.severity,"p0","p1");
  const bindings = exactRecord(root.currentCanonicalBindings,["F01","F02","D01","D02"]); for (const id of ["F01","F02","D01","D02"]) exactRecord(bindings[id],["bytes","physicalSha256","semanticSha256"]);
  const state = exactRecord(root.d02CurrentState,["companies","pendingSurfaces","pendingChannels","promotionCount","oracleStatus"]);
  const final = exactRecord(root.preservedFinalReport,["markdown","json","rewritten","findingsRemainP0P1Zero"]); const md=exactRecord(final.markdown,["bytes","physicalSha256"]); exactRecord(final.json,["bytes","physicalSha256"]);
  if (!Array.isArray(root.mergeRuns) || root.mergeRuns.length !== 2) throw new Error("runs"); root.mergeRuns.forEach((run,index)=>{const item=exactRecord(run,["run","ok","companyCount","mergedSha256"]);if(item.run!==index+1||item.ok!==true||item.companyCount!==60)throw new Error("run")});
  exactRecord(root.integrity,["physicalHashesUnchangedAfterRuns","canonicalOrRawModifiedByReviewer","sourceDatabaseManifestOrPromotionModifiedByReviewer"]);
  const current = exactRecord(bindings.D02,["bytes","physicalSha256","semanticSha256"]); const all=Object.fromEntries(Object.entries(bindings).map(([id,item])=>[id,record(item).semanticSha256]));
  return normalized(root,{...current,companyCount:state.companies,promotionCount:state.promotionCount},all,record(root.mergeRuns[0]).mergedSha256,md.physicalSha256,Number(md.bytes));
}

function normalized(root: Record<string,unknown>, current: Record<string,unknown>, all: unknown, merged: unknown, report: unknown,
  reportBytes?: number, reportPath?: string): NormalizedBinding {
  const hashes=exactRecord(all,["F01","F02","D01","D02"]); return { capturedAt:String(root.capturedAt), semanticSha256:String(current.semanticSha256), physicalSha256:String(current.physicalSha256).toLowerCase(), bytes:Number(current.bytes), companyCount:Number(current.companyCount), promotionCount:Number(current.promotionCount), allSemantic:Object.fromEntries(Object.entries(hashes).map(([id,hash])=>[id,String(hash)])), mergedSha256:String(merged), originalReportSha256:String(report).toLowerCase(), ...(reportBytes === undefined ? {} : {originalReportBytes:reportBytes}), ...(reportPath === undefined ? {} : {originalReportPath:reportPath}) };
}
function record(value: unknown): Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("record");return value as Record<string,unknown>}
function exactRecord(value: unknown, keys: string[]): Record<string,unknown>{const row=record(value);exact(row,keys);return row}
function exact(row: Record<string,unknown>, keys:string[]):void{if(Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key)))throw new Error("keys")}
function severity(value:unknown,p0:string,p1:string):void{const row=exactRecord(value,[p0,p1]);if(row[p0]!==0||row[p1]!==0)throw new Error("severity")}
function allTrue(row:Record<string,unknown>,...keys:string[]):boolean{return keys.every(key=>row[key]===true)}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function isSha(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }

export function parseStrictZonedIso100ns(value: unknown): bigint {
  if (typeof value !== "string") throw new Error("iso type");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) throw new Error("iso syntax");
  const year=Number(match[1]); const month=Number(match[2]); const day=Number(match[3]);
  const hour=Number(match[4]); const minute=Number(match[5]); const second=Number(match[6]);
  const fraction=match[7] ?? ""; const offsetHour=match[10] ? Number(match[10]) : 0; const offsetMinute=match[11] ? Number(match[11]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year,month) || hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) throw new Error("iso range");
  const offsetSign=match[9] === "-" ? -1 : 1; const offsetTotal=(match[8] === "Z" ? 0 : offsetSign*(offsetHour*60+offsetMinute));
  const fraction7=fraction.padEnd(7,"0"); const millis=Number(fraction7.slice(0,3));
  const local=new Date(0); local.setUTCFullYear(year,month-1,day); local.setUTCHours(hour,minute,second,millis);
  if (local.getUTCFullYear()!==year||local.getUTCMonth()!==month-1||local.getUTCDate()!==day||local.getUTCHours()!==hour||
      local.getUTCMinutes()!==minute||local.getUTCSeconds()!==second||local.getUTCMilliseconds()!==millis) throw new Error("iso roundtrip local");
  const epochMs=local.getTime()-offsetTotal*60_000; const replay=new Date(epochMs+offsetTotal*60_000);
  if (replay.getUTCFullYear()!==year||replay.getUTCMonth()!==month-1||replay.getUTCDate()!==day||replay.getUTCHours()!==hour||
      replay.getUTCMinutes()!==minute||replay.getUTCSeconds()!==second||replay.getUTCMilliseconds()!==millis) throw new Error("iso roundtrip offset");
  return BigInt(epochMs)*10_000n+BigInt(fraction7.slice(3));
}

function daysInMonth(year:number,month:number):number { return [4,6,9,11].includes(month)?30:month===2?(isLeapYear(year)?29:28):31; }
function isLeapYear(year:number):boolean { return year%4===0&&(year%100!==0||year%400===0); }
