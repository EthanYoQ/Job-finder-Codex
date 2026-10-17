import { V75_FENCE_MIGRATION_NAME, V75_FENCE_MIGRATION_SHA256, V75_FENCE_SCHEMA_SHA256, compileV75FenceProfileGuard } from "./v75FenceProfile";
import { JOB_DELTA_MIGRATION_NAME, JOB_DELTA_MIGRATION_SHA256, JOB_DELTA_SOURCE_GUARD_PROSRC_SHA256, JOB_DELTA_FUNCTION_MD5, JOB_DELTA_BASELINE_CHECK_MD5, JOB_DELTA_TRIGGER_PROFILES } from "./jobProjectionDeltaProfile";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { BuildIdentityArtifact } from "../readiness/buildIdentity";
import type { PlannedBatchWithSourcesInput } from "./ingestionRepository";
import { deriveCurrentStagedScheduleExpectation, STAGED_SCHEDULE_ORACLE_VERSION } from "../crawler/stagedScheduleAuthority";
import { sourcePlanConfigSha256, buildStagedSourceCrawlPlans } from "../crawler/sourcePlan";
import { candidateCompanies } from "../data/companyRegistry";
import { getPortableCoverageScope } from "../release/portableCoveragePolicy";
import { buildPendingRuntimeBatch } from "../crawler/runtimeAtomicEvidence";
import { hashCanonicalStringSet } from "../crawler/runtimeBatchIdentity";
import { CLOUD_PILOT_SQL45 as history } from "./cloudPilotSql45Manifest";
import { requiresBGradeTraversalCertificate } from "../crawler/traversalCertificate";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA } from "../crawler/sourceQualityAdmission";

/** Pure fixed control SQL only. Send each entire packet ONCE in one request.
 * Missing/uncertain acknowledgement requires read-only reconciliation, NEVER replay.
 * Supabase project routing is a caller obligation: PostgreSQL cannot prove its project ID.
 * No publication/evidence/Job writes, persistent objects, or credentials are created here.
 */
export interface CloudPilotControlInput {
  projectId: string; build: BuildIdentityArtifact;
  candidate: { id: string; goalId: string; version: number }; expiresAt: string;
  databaseIdentity?: {migrationVersion: typeof JOB_DELTA_MIGRATION_NAME | typeof V75_FENCE_MIGRATION_NAME; schemaHash:string; dbSnapshotHash:string}|undefined;
}
export interface CloudPilotPendingInput extends CloudPilotControlInput {
  holderId: string; planned: PlannedBatchWithSourcesInput;
}
export interface CloudPilotFinalizeInput extends CloudPilotPendingInput {
  outcome: "COMMITTED_EXACT"; sourceRow: Record<string, unknown>;
}
export interface CloudPilotDbStartedInput extends Omit<CloudPilotPendingInput,"expiresAt"|"holderId"> {
  context: CloudPilotPublicationContext;
}
export interface CloudPilotPublicationContext {
  checkedAt: string; sourceId: string; sourceConfigSha256: string;
  snapshotSha256?: string;
  jobs: Record<string,unknown>[];
  latestAccepted: Record<string,unknown>|null; firstAccepted: Record<string,unknown>|null;
  candidateRow: Record<string,unknown>; sourceRow: Record<string,unknown>; companyRow: Record<string,unknown>;
}
/** Select an existing required canonical source. Its actual current plan hash is
 * rechecked in every control packet; the selected proof's live issuer remains mandatory. */
const readySource=process.env.JOBFINDER_CLOUD_SOURCE_ID??"source-lilly-china-social";
const readyPlan=buildStagedSourceCrawlPlans(candidateCompanies).find(plan=>plan.source.id===readySource);
if(!readyPlan||!getPortableCoverageScope().requiredSourceIds.includes(readySource))throw Error("PILOT_CANONICAL_REQUIRED_SOURCE_ONLY");
export const CLOUD_PILOT_SOURCE=Object.freeze({id:readySource,
  ownerId:readySource==="source-csl-china-social"?"dot-cloud-csl-pilot":readySource==="source-lilly-china-social"?"dot-cloud-lilly-pilot":`dot-cloud-${readySource.slice(7)}-pilot`,
  sourceConfigSha256:sourcePlanConfigSha256(readyPlan)});
const SOURCE=CLOUD_PILOT_SOURCE.id, PROJECT="yiopvxysxrtrnvqxwgbx";
const identifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),sha=z.string().regex(/^[a-f0-9]{64}$/u);
const candidateSchema=z.object({id:identifier,goalId:z.literal("jobfinder-portable-required-40"),version:z.number().int().min(10).max(2147483647)}).strict();
const buildSchema=z.object({schemaVersion:z.literal(2),commitSha:z.string().regex(/^[a-f0-9]{40}$/u),sourceTreeSha256:sha,runtimeTreeSha256:sha,contentSha256:sha}).strict();
const commonSchema=z.object({projectId:z.literal(PROJECT),build:buildSchema,candidate:candidateSchema,expiresAt:z.string().datetime(),databaseIdentity:z.object({migrationVersion:z.enum([JOB_DELTA_MIGRATION_NAME,V75_FENCE_MIGRATION_NAME]),schemaHash:sha,dbSnapshotHash:sha}).strict().optional()}).strict();
const pendingSchema=commonSchema.extend({holderId:z.string().uuid(),planned:z.unknown()}).strict();
const finalizeSchema=pendingSchema.extend({outcome:z.literal("COMMITTED_EXACT"),sourceRow:z.record(z.unknown())}).strict();
const publicationContextSchema=z.object({snapshotSha256:sha.optional(),checkedAt:z.string().datetime({offset:true}),sourceId:z.literal(SOURCE),sourceConfigSha256:z.literal(CLOUD_PILOT_SOURCE.sourceConfigSha256),
 jobs:z.array(z.record(z.unknown())),latestAccepted:z.record(z.unknown()).nullable(),firstAccepted:z.record(z.unknown()).nullable(),
 candidateRow:z.record(z.unknown()),sourceRow:z.record(z.unknown()),companyRow:z.record(z.unknown())}).strict();
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
const text=(s:string)=>`E'${s.replaceAll("\\","\\\\").replaceAll("'","''")}'`;
const json=(v:unknown)=>`${text(JSON.stringify(v))}::jsonb`;
const quote=(s:string)=>`"${s}"`; // All identifiers below come from closed, locally constructed objects.
function canonical(v:unknown):string { if(v instanceof Date)return JSON.stringify(v); if(Array.isArray(v))return `[${v.map(canonical).join(',')}]`;if(v&&typeof v==="object")return `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,c])=>`${JSON.stringify(k)}:${canonical(c)}`).join(',')}}`;return JSON.stringify(v); }
function candidateData(input:CloudPilotControlInput){
  const {build,candidate}=input;
  if(input.databaseIdentity&&(candidate.version<=49||input.databaseIdentity.schemaHash===history.databaseIdentity.schemaHash||build.commitSha==="47b74924f850a4d329460b71717b36df9a5159b8"))throw Error("PILOT_INCREMENTAL_NEW_IDENTITY_REQUIRED");
  if(build.contentSha256!==digest(JSON.stringify({schemaVersion:2,commitSha:build.commitSha,sourceTreeSha256:build.sourceTreeSha256,runtimeTreeSha256:build.runtimeTreeSha256})))throw Error("PILOT_BUILD_DIGEST");
  if(candidate.id===history.currentCandidate.id)throw Error("PILOT_NEW_CANDIDATE_REQUIRED");
  const e=deriveCurrentStagedScheduleExpectation(build);
  if(e.plans.length!==41||e.minimumStableCompanyCount!==41)throw Error("PILOT_FULL_AUTHORITY_REQUIRED");
  return {...candidate,commitSha:e.commitSha,...(input.databaseIdentity??history.databaseIdentity),
    rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount,status:"BUILDING"};
}
function expectedPending(input:CloudPilotPendingInput){
  const c=candidateData(input),e=deriveCurrentStagedScheduleExpectation(input.build),plan=e.plans.find(p=>p.source.id===SOURCE)!;
  if(!plan||sourcePlanConfigSha256(plan)!==CLOUD_PILOT_SOURCE.sourceConfigSha256)throw Error("PILOT_SOURCE_CONFIG_DRIFT");
  const b=input.planned?.batch;
  identifier.parse(b?.id);
  const startedAt=new Date(b.startedAt);
  if(!Number.isFinite(startedAt.getTime()))throw Error("PILOT_STARTED_AT");
  const expected=buildPendingRuntimeBatch(b.id,[plan],{releaseCandidateId:c.id,commitSha:c.commitSha,rosterSha256:c.rosterHash,sourcePlanSha256:c.sourcePlanHash,sourceConfigSha256:c.sourceConfigHash,adapterBundleSha256:c.adapterBundleHash,batchKind:"SCHEDULED",ownerId:CLOUD_PILOT_SOURCE.ownerId,expectedPlannedSourceIds:[SOURCE],expectedPlannedSourceSetSha256:hashCanonicalStringSet([SOURCE]),expectedPlannedSourceCount:1},startedAt);
  if(canonical(input.planned)!==canonical(expected))throw Error("PILOT_EXACT_PLANNED_PROJECTION_REQUIRED");
  return {c,expected,plan};
}
function insert(table:string,row:Record<string,unknown>){const cols=Object.keys(row).map(quote).join(',');return `INSERT INTO public.${quote(table)} (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::public.${quote(table)},${json(row)});`;}
function matches(table:string,alias:string,row:Record<string,unknown>,data=json(row)){return `EXISTS(SELECT 1 FROM jsonb_populate_record(NULL::public.${quote(table)},${data}) expected WHERE ${Object.keys(row).map(k=>`${alias}.${quote(k)} IS NOT DISTINCT FROM expected.${quote(k)}`).join(' AND ')})`;}
const fail=(condition:string,code:string)=>`IF ${condition} THEN RAISE EXCEPTION '${code}'; END IF;`;
function historyGuard(input:Pick<CloudPilotControlInput,"databaseIdentity">){
 const incremental=input.databaseIdentity!==undefined;
 const fenced=input.databaseIdentity?.migrationVersion===V75_FENCE_MIGRATION_NAME;
 if(fenced&&input.databaseIdentity?.schemaHash!==V75_FENCE_SCHEMA_SHA256)throw Error("PILOT_SCHEMA50_MANIFEST_DRIFT");
 if(incremental&&(!/^[a-f0-9]{64}$/.test(JOB_DELTA_MIGRATION_SHA256)||!/^[a-f0-9]{64}$/.test(JOB_DELTA_SOURCE_GUARD_PROSRC_SHA256)))throw Error("PILOT_INCREMENTAL_PROFILE_NOT_VERIFIED");
 const migrations=incremental?[...history.migrations,{migrationName:JOB_DELTA_MIGRATION_NAME,checksum:JOB_DELTA_MIGRATION_SHA256},...(fenced?[{migrationName:V75_FENCE_MIGRATION_NAME,checksum:V75_FENCE_MIGRATION_SHA256}]:[])]:history.migrations;
 const guard=incremental?fail(`(SELECT encode(extensions.digest(convert_to(prosrc,'UTF8'),'sha256'),'hex') FROM pg_proc WHERE oid=to_regprocedure('public.enforce_source_result_state_machine()')) IS DISTINCT FROM ${text(JOB_DELTA_SOURCE_GUARD_PROSRC_SHA256)}`,"PILOT_INCREMENTAL_GUARD_DRIFT")
 :fail(`(SELECT md5(pg_get_functiondef(to_regprocedure('public.enforce_source_result_state_machine()')))) IS DISTINCT FROM ${text(history.sourceResultGuardMd5)}`,"PILOT_SQL45_GUARD_DRIFT");
 return `LOCK TABLE public."_prisma_migrations" IN SHARE MODE;
${fail(`(SELECT count(*) FROM public."_prisma_migrations") <> ${migrations.length} OR EXISTS(SELECT 1 FROM public."_prisma_migrations" m FULL JOIN jsonb_to_recordset(${json(migrations)}) e("migrationName" text,checksum text) ON m.migration_name=e."migrationName" WHERE m.migration_name IS NULL OR e."migrationName" IS NULL OR m.checksum IS DISTINCT FROM e.checksum OR m.finished_at IS NULL OR m.rolled_back_at IS NOT NULL) OR (SELECT count(DISTINCT migration_name) FROM public."_prisma_migrations") <> ${migrations.length}`,"PILOT_MIGRATION_HISTORY")}
${guard}
${fenced?compileV75FenceProfileGuard():""}
${incremental?JOB_DELTA_TRIGGER_PROFILES.map(trigger=>fail(`NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=${text('public.'+quote(trigger.tableName))}::regclass AND t.tgname=${text(trigger.name)} AND t.tgenabled='O' AND t.tgdeferrable AND t.tginitdeferred AND md5(pg_get_triggerdef(t.oid))=${text(trigger.md5)})`,"PILOT_INCREMENTAL_TRIGGER_DRIFT")).join("\n"):""}
${incremental?fail(`(SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='public."CrawlBatchSourceResult"'::regclass AND conname='CrawlBatchSourceResult_baseline_transition_shape_check') IS DISTINCT FROM ${text(JOB_DELTA_BASELINE_CHECK_MD5)}`,"PILOT_INCREMENTAL_BASELINE_CHECK_DRIFT"):""}
${incremental?Object.entries(JOB_DELTA_FUNCTION_MD5).map(([name,md5])=>fail(`(SELECT md5(pg_get_functiondef(to_regprocedure(${text(name)})))) IS DISTINCT FROM ${text(md5)}`,"PILOT_INCREMENTAL_FUNCTION_DEFINITION_DRIFT")).join("\n"):""}`;
}
function candidateGuard(c:ReturnType<typeof candidateData>){return `PERFORM 1 FROM public."ReleaseCandidate" r WHERE r.id=${text(c.id)} AND ${matches("ReleaseCandidate","r",c)} FOR SHARE;
${fail("NOT FOUND","PILOT_CANDIDATE_DRIFT")}`;}
function leaseGuard(holderId:string){return `PERFORM 1 FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl' FOR UPDATE;
${fail("NOT FOUND","CRAWL_LEASE_LOST")}
UPDATE public."CrawlCoordinatorLock" SET "heartbeatAt"=clock_timestamp() WHERE id='formal-crawl' AND "holderId"=${text(holderId)} AND "heartbeatAt">clock_timestamp()-interval '300 seconds';
GET DIAGNOSTICS affected=ROW_COUNT; ${fail("affected <> 1","CRAWL_LEASE_LOST")}`;}
function packet(input:CloudPilotControlInput,body:string,resultSelect:string){
  const gate=fail(`clock_timestamp() >= ${text(input.expiresAt)}::timestamptz`,"PILOT_REQUEST_EXPIRED");
  const doBody=`DECLARE affected bigint; aggregate_hash text; current_hash text; current_count bigint; BEGIN\n${gate}\n${body}\n${gate}\nEND;`;
  let delimiter="$pilot_control$";while(doBody.includes(delimiter))delimiter=delimiter.replace(/\$$/,"_x$");
  return `BEGIN;\nSET LOCAL statement_timeout='8000ms';\nSET LOCAL lock_timeout='1000ms';\nSET LOCAL TIME ZONE 'UTC';\nDO ${delimiter}\n${doBody}\n${delimiter};\n${resultSelect};\nCOMMIT;`;
}
export function compileCloudPilotCandidateSql(input:CloudPilotControlInput):string{
  commonSchema.parse(input);const c=candidateData(input),identity=Object.fromEntries(Object.entries(c).filter(([k])=>!["id","goalId","version","dbSnapshotHash","schemaHash","migrationVersion","status"].includes(k)));
  return packet(input,`${historyGuard(input)}
LOCK TABLE public."ReleaseCandidate" IN SHARE ROW EXCLUSIVE MODE;
${fail(`NOT EXISTS(SELECT 1 FROM public."ReleaseCandidate" r WHERE ${matches("ReleaseCandidate","r",history.currentCandidate)})`,"PILOT_PROVENANCE_DRIFT")}
${fail(`EXISTS(SELECT 1 FROM public."ReleaseCandidate" r WHERE r.id=${text(c.id)} OR (r."goalId"=${text(c.goalId)} AND r.version=${c.version}) OR ${matches("ReleaseCandidate","r",identity)})`,"PILOT_CANDIDATE_CONFLICT")}
${insert("ReleaseCandidate",c)}`,`SELECT to_jsonb(r) AS candidate FROM public."ReleaseCandidate" r WHERE id=${text(c.id)}`);
}
const BATCH_COUNTERS=["transportSucceeded","transportFailed","adapterSucceeded","adapterFailed","completenessVerified","completenessIncomplete","atomicCommitted","atomicFailed","failedSource","blockedSource","skippedSource"];
const SOURCE_COUNTERS=["raw","parsed","valid","normalized","dedupeInput","dedupeOutput","parseDiscard","validationDiscard","normalizationDiscard","dedupeDiscard","collision","discard"];
const SOURCE_NULLS=["finishedAt","expectedJobCount","expectedEvidenceKind","expectedSurfaceSha256","visitedSurfaceSha256","expectedChannelSha256","visitedChannelSha256","canonicalCurrentJobSetSha256","canonicalGraceJobSetSha256","canonicalVisibleJobSetSha256","canonicalOutputSetSha256","adapterInputCount","adapterOutputCount","adapterLossCount","adapterCollisionGroupCount","adapterReconciliationSha256","collisionLedgerSha256","completenessCertificate","completenessCertificateSha256","blockerCode","blockerReason","failureCategory","failureDiagnosticCode","fetchAttemptCount","retryCount","failureCode","failureReason"];
const zeroes=(keys:string[])=>Object.fromEntries(keys.map(k=>[k+"Count",0]));
function sourceData(p:PlannedBatchWithSourcesInput){return {...p.sources[0]!,releaseCandidateId:p.batch.releaseCandidateId,batchId:p.batch.id,transportState:"PENDING",adapterState:"PENDING",completenessState:"PENDING",atomicCommitState:"PENDING",...zeroes(SOURCE_COUNTERS),...Object.fromEntries(SOURCE_NULLS.map(k=>[k,null])),retryReasonCodes:[]};}
export function compileCloudPilotCreatePendingSql(input:CloudPilotPendingInput):string{
  pendingSchema.parse(input);const {c,expected:p,plan}=expectedPending(input);
  const sourceConfig={id:SOURCE,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl};
  return packet(input,`${leaseGuard(input.holderId)}\n${historyGuard(input)}\n${candidateGuard(c)}
PERFORM 1 FROM public."RecruitmentSource" r WHERE ${matches("RecruitmentSource","r",sourceConfig)} FOR SHARE;
${fail("NOT FOUND","PILOT_SOURCE_CONFIG_DRIFT")}
${fail(`${text(p.batch.startedAt.toISOString())}::timestamptz > clock_timestamp()+interval '1 second' OR ${text(p.batch.startedAt.toISOString())}::timestamptz < clock_timestamp()-interval '24 hours'`,"PILOT_PENDING_TIME_DRIFT")}
${insert("CrawlBatch",{...p.batch,status:"RUNNING",finishedAt:null,aggregateJobSetSha256:null,...zeroes(BATCH_COUNTERS)})}
${insert("CrawlBatchSourceResult",sourceData(p))}`,
`SELECT jsonb_build_object('batch',to_jsonb(b),'sourceRows',(SELECT jsonb_agg(to_jsonb(s)) FROM public."CrawlBatchSourceResult" s WHERE s."batchId"=b.id)) AS result FROM public."CrawlBatch" b WHERE b.id=${text(p.batch.id)}`);
}
export function compileCloudPilotFinalizeSql(input:CloudPilotFinalizeInput):string{
  finalizeSchema.parse(input);const {c,expected:p}=expectedPending(input),row=input.sourceRow;
  const requiredKeys=[...Object.keys(sourceData(p)),"createdAt","baselinePreviousSourceResultId","baselinePreviousJobCount","baselineChangeReason"].sort();
  if(canonical(Object.keys(row).sort())!==canonical(requiredKeys)||row.transportState!=="SUCCEEDED"||row.adapterState!=="SUCCEEDED"||row.completenessState!=="VERIFIED"||row.atomicCommitState!=="COMMITTED"||row.finishedAt==null||row.failureCode!==null)throw Error("PILOT_COMMITTED_EXACT_SOURCE_REQUIRED");
  const expectedSource={...p.sources[0]!,releaseCandidateId:c.id,batchId:p.batch.id};
  for(const [key,value] of Object.entries(expectedSource))if(key!=="startedAt"&&canonical(row[key])!==canonical(value))throw Error("PILOT_SOURCE_TUPLE_DRIFT");
  const dbStartedAt=row.startedAt instanceof Date?row.startedAt.toISOString():String(row.startedAt);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z?$/.test(dbStartedAt)||new Date(dbStartedAt.endsWith("Z")?dbStartedAt:dbStartedAt+"Z").getTime()!==p.sources[0]!.startedAt.getTime())throw Error("PILOT_SOURCE_TUPLE_DRIFT");
  const sourceWhere=`s.id=${text(p.sources[0]!.id)} AND s."releaseCandidateId"=${text(c.id)} AND s."batchId"=${text(p.batch.id)} AND s."sourceId"=${text(SOURCE)}`;
  const memberWhere=`"releaseCandidateId"=${text(c.id)} AND "batchId"=${text(p.batch.id)} AND "sourceResultId"=${text(p.sources[0]!.id)} AND "sourceId"=${text(SOURCE)} AND "setKind"='CURRENT'`;
  const success=`s."transportState"='SUCCEEDED' AND s."adapterState"='SUCCEEDED' AND s."completenessState"='VERIFIED' AND s."atomicCommitState"='COMMITTED' AND s."failureCode" IS NULL`;
  return packet(input,`${leaseGuard(input.holderId)}\n${historyGuard(input)}\n${candidateGuard(c)}
PERFORM 1 FROM public."CrawlBatch" b WHERE b.id=${text(p.batch.id)} AND ${matches("CrawlBatch","b",{...p.batch,status:"RUNNING",finishedAt:null,aggregateJobSetSha256:null,...zeroes(BATCH_COUNTERS)})} FOR UPDATE;
${fail("NOT FOUND","PILOT_BATCH_DRIFT")}
${fail(`(SELECT count(*) FROM public."CrawlBatchSourceResult" WHERE "batchId"=${text(p.batch.id)}) <> 1`,"PILOT_SOURCE_DENOMINATOR")}
PERFORM 1 FROM public."CrawlBatchSourceResult" s WHERE ${sourceWhere} AND ${success} AND s IS NOT DISTINCT FROM jsonb_populate_record(NULL::public."CrawlBatchSourceResult",${json(row)}) FOR SHARE;
${fail("NOT FOUND","PILOT_COMMITTED_EXACT_SOURCE_REQUIRED")}
SELECT count(*),encode(extensions.digest(convert_to('['||coalesce(string_agg(to_json("jobKey")::text,',' ORDER BY convert_to("jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex'),
 encode(extensions.digest(convert_to('['||coalesce(string_agg('['||to_json("sourceId")::text||','||to_json("jobKey")::text||']',',' ORDER BY convert_to('['||to_json("sourceId")::text||','||to_json("jobKey")::text||']','UTF8')),'')||']','UTF8'),'sha256'),'hex')
 INTO current_count,current_hash,aggregate_hash FROM public."LifecycleSetEvidenceMember" WHERE ${memberWhere};
${fail(`NOT EXISTS(SELECT 1 FROM public."CrawlBatchSourceResult" s WHERE ${sourceWhere} AND s."dedupeOutputCount"=current_count AND s."canonicalCurrentJobSetSha256"=current_hash AND s."canonicalOutputSetSha256"=current_hash)`,"PILOT_CURRENT_MEMBERS_DRIFT")}
UPDATE public."CrawlBatch" b SET "transportSucceededCount"=(s."transportState"='SUCCEEDED')::int,"transportFailedCount"=(s."transportState"='FAILED')::int,
 "adapterSucceededCount"=(s."adapterState"='SUCCEEDED')::int,"adapterFailedCount"=(s."adapterState"='FAILED')::int,
 "completenessVerifiedCount"=(${success})::int,"completenessIncompleteCount"=(s."completenessState" IN ('INCOMPLETE','NEEDS_MANUAL_COMPLETENESS_REVIEW'))::int,
 "atomicCommittedCount"=(s."atomicCommitState"='COMMITTED')::int,"atomicFailedCount"=(s."atomicCommitState" IN ('FAILED','ROLLED_BACK'))::int,
 "failedSourceCount"=(NOT (${success}))::int,"blockedSourceCount"=0,"skippedSourceCount"=(s."transportState"='SKIPPED')::int,
 "aggregateJobSetSha256"=aggregate_hash,"heartbeatAt"=clock_timestamp(),"finishedAt"=clock_timestamp(),status='SUCCESS'
 FROM public."CrawlBatchSourceResult" s WHERE b.id=${text(p.batch.id)} AND b.status='RUNNING' AND ${sourceWhere};
GET DIAGNOSTICS affected=ROW_COUNT; ${fail("affected <> 1","PILOT_FINALIZATION_ROW_COUNT")}`,
`SELECT to_jsonb(b) AS batch FROM public."CrawlBatch" b WHERE id=${text(p.batch.id)}`);
}

/** The same complete projection is read before preparation and compared under
 * the formal-crawl row lock. checkedAt is diagnostic, never write authority. */
function publicationContextQuery(candidateId:string,sourceAdmissionPolicy?:typeof SOURCE_QUALITY_POLICY_ID,incremental=false):string {
 if(sourceAdmissionPolicy!==undefined&&sourceAdmissionPolicy!==SOURCE_QUALITY_POLICY_ID)throw Error('PILOT_PUBLICATION_POLICY_INVALID');
 const portable=sourceAdmissionPolicy===SOURCE_QUALITY_POLICY_ID,bGrade=!portable&&requiresBGradeTraversalCertificate(readyPlan!);
 const certificate=portable?SOURCE_QUALITY_RECEIPT_SCHEMA:bGrade?'b-grade-independent-traversal-v2':'a-grade-official-total-v2';
 const certificateSql=incremental?`(CASE WHEN r."completenessCertificate"->>'schemaVersion'='job-projection-delta-receipt-v1' THEN r."completenessCertificate"->'legacyCertificate' ELSE r."completenessCertificate" END)`:`r."completenessCertificate"`;
 return `WITH matching AS (
 SELECT r.*${bGrade||incremental?`,coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public."CrawlObservation" o WHERE o."sourceResultId"=r.id),'[]'::jsonb) AS observations`:''} FROM public."CrawlBatchSourceResult" r JOIN public."CrawlBatch" b ON b.id=r."batchId"
 WHERE r."sourceId"=${text(SOURCE)} AND r."sourceConfigHash"=${text(CLOUD_PILOT_SOURCE.sourceConfigSha256)}
 AND r."completenessState"='VERIFIED' AND r."atomicCommitState"='COMMITTED'
 AND r."completenessCertificateSha256" IS NOT NULL
 AND ${certificateSql}->>'schemaVersion'=${text(certificate)}${portable?` AND ${certificateSql}->>'policyId'=${text(SOURCE_QUALITY_POLICY_ID)}`:''} AND b.kind<>'MANUAL_SOURCE'
 ), jobs AS (
 SELECT j."dedupeKey",j."companyId",j."sourceId",j."sourceJobId",j."officialTitle",j."auxiliaryChineseTitle",j."officialUrl",j."listUrl",j."locationRaw",j.city,j.cities,j.category,j."officialPublishedAt",j."firstSeenAt",j."lastSeenAt",j."missingSuccessCount",j."lifecycleStatus"${incremental?',j."visibleInFrontend",j."isNew"':''},
 jsonb_build_object('atsKind',s."atsKind",'kind',s.kind,'status',s.status,'officialEntryUrl',s."officialEntryUrl",'officialChainEvidenceUrl',s."officialChainEvidenceUrl") AS source,
 jsonb_build_object('officialChineseName',c."officialChineseName") AS company
 FROM public."Job" j JOIN public."RecruitmentSource" s ON s.id=j."sourceId" JOIN public."Company" c ON c.id=j."companyId"
 WHERE j."sourceId"=${text(SOURCE)}
 ) SELECT jsonb_build_object('checkedAt',clock_timestamp(),'sourceId',${text(SOURCE)},'sourceConfigSha256',${text(CLOUD_PILOT_SOURCE.sourceConfigSha256)},
 'jobs',coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j."lastSeenAt" DESC,j."dedupeKey") FROM jobs j),'[]'::jsonb),
 'latestAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" DESC,id DESC LIMIT 1),
 'firstAccepted',(SELECT to_jsonb(r) FROM matching r ORDER BY "finishedAt" ASC,id ASC LIMIT 1),
 'candidateRow',(SELECT to_jsonb(r) FROM public."ReleaseCandidate" r WHERE id=${text(candidateId)}),
 'sourceRow',(SELECT to_jsonb(r) FROM public."RecruitmentSource" r WHERE id=${text(SOURCE)}),
 'companyRow',(SELECT to_jsonb(r) FROM public."Company" r WHERE id=${text(readyPlan!.company.id)})) AS context`;
}
export function compileCloudPilotPublicationContextSql(input:Omit<CloudPilotControlInput,'expiresAt'>,sourceAdmissionPolicy?:typeof SOURCE_QUALITY_POLICY_ID):string {
 const checked=commonSchema.parse({...input,expiresAt:new Date(0).toISOString()});
 candidateData(checked);
 return `SELECT context || jsonb_build_object('snapshotSha256',${publicationContextDigestSql('context')}) AS context FROM (${publicationContextQuery(input.candidate.id,sourceAdmissionPolicy,input.databaseIdentity!==undefined)}) snapshot;`;
}

// PostgreSQL computes both sides from the same full jsonb projection. Only
// the read-time clock is omitted, exactly as in the original object comparison.
function publicationContextDigestSql(value:string):string {
 return `encode(extensions.digest(convert_to((${value}-'checkedAt')::text,'UTF8'),'sha256'),'hex')`;
}
export function publicationContextComparisonValue(context:CloudPilotPublicationContext){
 return context.snapshotSha256 ? {sourceId:context.sourceId,sourceConfigSha256:context.sourceConfigSha256,snapshotSha256:context.snapshotSha256} : context;
}

/** Fixed control fragments used only by the attested in-process publication
 * compiler. No arbitrary SQL or write-plan input is accepted here. */
export function prepareCloudPilotDbStartedControl(input:CloudPilotDbStartedInput,terminal:Record<string,unknown>,holderId:string,expiresAt:string,originalTimesThrough:string,sourceAdmissionPolicy?:typeof SOURCE_QUALITY_POLICY_ID){
 const context=publicationContextSchema.parse(input.context);
 const pendingInput={projectId:input.projectId,build:input.build,candidate:input.candidate,planned:input.planned,holderId,expiresAt,...(input.databaseIdentity?{databaseIdentity:input.databaseIdentity}:{})};
 pendingSchema.parse(pendingInput);
 const {c,expected:p,plan}=expectedPending(pendingInput);
 const expectedSource={...p.sources[0]!,releaseCandidateId:c.id,batchId:p.batch.id};
 for(const [key,value] of Object.entries(expectedSource))if(canonical(terminal[key])!==canonical(value))throw Error('PILOT_SOURCE_TUPLE_DRIFT');
 if(terminal.atomicCommitState!=='COMMITTED'||terminal.completenessState!=='VERIFIED'||terminal.transportState!=='SUCCEEDED'||terminal.adapterState!=='SUCCEEDED'||!terminal.finishedAt)throw Error('PILOT_REAL_CERTIFICATE_REQUIRED');
 for(const [key,value] of Object.entries(c))if(canonical(context.candidateRow[key])!==canonical(value))throw Error('PILOT_CANDIDATE_DRIFT');
 const sourceConfig={id:SOURCE,companyId:plan.company.id,kind:plan.source.kind,atsKind:plan.source.atsKind,status:plan.source.status,officialEntryUrl:plan.source.officialEntryUrl,officialChainEvidenceUrl:plan.source.officialChainEvidenceUrl};
 for(const [key,value] of Object.entries(sourceConfig))if(canonical(context.sourceRow[key])!==canonical(value))throw Error('PILOT_SOURCE_CONFIG_DRIFT');
 if(context.companyRow.id!==plan.company.id||context.companyRow.officialChineseName!==plan.company.officialChineseName)throw Error('PILOT_COMPANY_DRIFT');
 const gate=fail(`clock_timestamp() >= ${text(expiresAt)}::timestamptz`,'PILOT_REQUEST_EXPIRED');
 z.string().datetime().parse(originalTimesThrough);
 const originalTimes=fail(`${text(originalTimesThrough)}::timestamptz>clock_timestamp()+interval '1 second'`,'PILOT_ORIGINAL_TIMES_AHEAD');
 const before=`${fail("current_setting('transaction_isolation') <> 'read committed'",'PILOT_READ_COMMITTED_REQUIRED')}
 ${gate}
 ${originalTimes}
 INSERT INTO public."CrawlCoordinatorLock" (id,"holderId","acquiredAt","heartbeatAt",metadata)
 VALUES ('formal-crawl','',clock_timestamp(),clock_timestamp(),'portable-quality-sync-v1:released') ON CONFLICT (id) DO NOTHING;
 PERFORM 1 FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl' FOR UPDATE;
 ${fail('NOT FOUND','CRAWL_LEASE_LOST')}
 ${gate}
 ${originalTimes}
 ${fail(`EXISTS(SELECT 1 FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl' AND "holderId"=${text(holderId)})`,'PILOT_REQUEST_OWNER_REUSED')}
 UPDATE public."CrawlCoordinatorLock" SET "holderId"=${text(holderId)},"acquiredAt"=clock_timestamp(),"heartbeatAt"=clock_timestamp(),metadata='portable-quality-sync-v1'
 WHERE id='formal-crawl' AND ("holderId"='' OR "heartbeatAt"<=clock_timestamp()-interval '300 seconds');
 GET DIAGNOSTICS affected=ROW_COUNT; ${fail('affected <> 1','CRAWL_LEASE_BUSY')}
 -- The historical advisory-only writers do not share our owner row. These
 -- short, self-exclusive table locks also exclude inserts and Batch.kind
 -- changes until commit. Ordinary SELECT remains available.
 LOCK TABLE public."Job",public."CrawlBatchSourceResult",public."CrawlBatch"${requiresBGradeTraversalCertificate(plan)?',public."CrawlObservation"':''} IN SHARE ROW EXCLUSIVE MODE;
 ${historyGuard(input)}
 ${candidateGuard(c)}
 PERFORM 1 FROM public."RecruitmentSource" r WHERE ${matches('RecruitmentSource','r',sourceConfig)} FOR SHARE;
 ${fail('NOT FOUND','PILOT_SOURCE_CONFIG_DRIFT')}
 PERFORM 1 FROM public."Company" WHERE id=${text(plan.company.id)} FOR SHARE;
 ${fail('NOT FOUND','PILOT_COMPANY_DRIFT')}
 ${fail(`EXISTS(SELECT 1 FROM public."CrawlBatch" WHERE id=${text(p.batch.id)}) OR EXISTS(SELECT 1 FROM public."CrawlBatchSourceResult" WHERE id=${text(p.sources[0]!.id)})`,'PILOT_REQUEST_ALREADY_APPLIED')}
 SELECT context INTO current_context FROM (${publicationContextQuery(c.id,sourceAdmissionPolicy,input.databaseIdentity!==undefined)}) snapshot_now;
 ${fail(context.snapshotSha256 ? `${publicationContextDigestSql('current_context')} IS DISTINCT FROM (expected_context_data->>'snapshotSha256')` : `(current_context-'checkedAt') IS DISTINCT FROM (expected_context_data-'checkedAt')`,'PILOT_CONTEXT_CHANGED')}
 ${gate}
 ${insert('CrawlBatch',{...p.batch,status:'RUNNING',finishedAt:null,aggregateJobSetSha256:null,...zeroes(BATCH_COUNTERS)})}
 ${insert('CrawlBatchSourceResult',sourceData(p))}`;
 const sourceWhere=`s.id=${text(p.sources[0]!.id)} AND s."releaseCandidateId"=${text(c.id)} AND s."batchId"=${text(p.batch.id)} AND s."sourceId"=${text(SOURCE)}`;
 const members=`"releaseCandidateId"=${text(c.id)} AND "batchId"=${text(p.batch.id)} AND "sourceResultId"=${text(p.sources[0]!.id)} AND "sourceId"=${text(SOURCE)} AND "setKind"='CURRENT'`;
 const after=`${gate}
 PERFORM 1 FROM public."CrawlBatchSourceResult" s WHERE ${sourceWhere} AND ${matches('CrawlBatchSourceResult','s',terminal,'source_result_data')} FOR SHARE;
 ${fail('NOT FOUND','PILOT_COMMITTED_EXACT_SOURCE_REQUIRED')}
 SELECT count(*),encode(extensions.digest(convert_to('['||coalesce(string_agg(to_json("jobKey")::text,',' ORDER BY convert_to("jobKey",'UTF8')),'')||']','UTF8'),'sha256'),'hex'),
 encode(extensions.digest(convert_to('['||coalesce(string_agg('['||to_json("sourceId")::text||','||to_json("jobKey")::text||']',',' ORDER BY convert_to('['||to_json("sourceId")::text||','||to_json("jobKey")::text||']','UTF8')),'')||']','UTF8'),'sha256'),'hex')
 INTO current_count,current_hash,aggregate_hash FROM public."LifecycleSetEvidenceMember" WHERE ${members};
 ${fail(`current_count<>${Number(terminal.dedupeOutputCount)} OR current_hash IS DISTINCT FROM ${text(String(terminal.canonicalCurrentJobSetSha256))} OR current_hash IS DISTINCT FROM ${text(String(terminal.canonicalOutputSetSha256))}`,'PILOT_CURRENT_MEMBERS_DRIFT')}
 UPDATE public."CrawlBatch" SET "transportSucceededCount"=1,"adapterSucceededCount"=1,"completenessVerifiedCount"=1,"atomicCommittedCount"=1,
 "aggregateJobSetSha256"=aggregate_hash,"heartbeatAt"=clock_timestamp(),"finishedAt"=clock_timestamp(),status='SUCCESS'
 WHERE id=${text(p.batch.id)} AND status='RUNNING';
 GET DIAGNOSTICS affected=ROW_COUNT; ${fail('affected <> 1','PILOT_FINALIZATION_ROW_COUNT')}
 -- Force all three SQL48 deferred gates inside the bounded DO. In v2 only,
 -- keep the additional Job projection check deferred until actual transaction
 -- commit, so later statements cannot silently invalidate this receipt.
 ${input.databaseIdentity?'SET CONSTRAINTS "CrawlBatchSourceResult_verified_lifecycle_projection", "LifecycleSetEvidenceMember_exact_projection", "TransportAttemptEvidence_nonempty_refs" IMMEDIATE;':'SET CONSTRAINTS ALL IMMEDIATE;'}
 ${gate}
 UPDATE public."CrawlCoordinatorLock" SET "holderId"='',"heartbeatAt"=clock_timestamp(),metadata='portable-quality-sync-v1:released'
 WHERE id='formal-crawl' AND "holderId"=${text(holderId)};
 GET DIAGNOSTICS affected=ROW_COUNT; ${fail('affected <> 1','CRAWL_LEASE_LOST')}`;
 return {before,after,expectedContext:publicationContextComparisonValue(context)};
}
