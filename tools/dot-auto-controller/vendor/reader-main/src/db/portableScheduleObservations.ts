import { isCurrentBGradeCertificateSchema } from "../crawler/traversalCertificate";
import { A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION } from "../crawler/completenessCertificate";
import { BATCH_ABORTED_BEFORE_SOURCE_TERMINAL, isProvenUnstartedBatchAbort } from "../domain/unstartedBatchAbort";
import { SOURCE_QUALITY_POLICY_ID, SOURCE_QUALITY_RECEIPT_SCHEMA } from "../crawler/sourceQualityAdmission";
import type { Prisma } from '@prisma/client';
import { selectPortableSourceSnapshots } from '../domain/portablePublicSnapshot';
import { nextP0CrawlWindow } from '../crawler/schedule';
import { sourcePlanConfigSha256, type SourceCrawlPlan } from '../crawler/sourcePlan';
import { portableSourceResultSelect, type PortableSourceResultRow } from './portablePublicSnapshotRepository';
import type { PersistedCrawlObservationRow } from './crawlStateRepository';
export interface PortableScheduleResultReader {
  findMany(args:Prisma.CrawlBatchSourceResultFindManyArgs):Promise<PortableSourceResultRow[]>;
}
/** Portable-only scheduling history. A legacy observation's successful flag is
 * not evidence of acceptance under this configuration and publication policy. */
export async function readPortableScheduleObservations(reader:PortableScheduleResultReader,plan:SourceCrawlPlan,now:Date):Promise<PersistedCrawlObservationRow[]> {
  const sourceConfigHash=sourcePlanConfigSha256(plan);
  const rows=structuredClone(await reader.findMany({
    where:{sourceId:plan.source.id,sourceConfigHash,batch:{is:{kind:'SCHEDULED'}},finishedAt:{not:null},OR:[{transportState:{not:'SKIPPED'}},{failureCode:BATCH_ABORTED_BEFORE_SOURCE_TERMINAL}]},
    select:portableSourceResultSelect,orderBy:[{startedAt:'desc'},{id:'desc'}]
  }));
  // Limit meaningful observations after proving neutral closures; otherwise a run
  // of aborts can hide the last actual success or failure behind the query limit.
  return rows.filter(row=>row.sourceId===plan.source.id&&row.sourceConfigHash===sourceConfigHash&&
    row.batch.kind==='SCHEDULED'&&row.finishedAt!==null&&(row.transportState!=='SKIPPED'||row.failureCode===BATCH_ABORTED_BEFORE_SOURCE_TERMINAL)&&
    !isProvenUnstartedBatchAbort(row,now)&&!completedLegacySuccess(row)).slice(0,10).map(row=>{
    if(!(row.finishedAt instanceof Date)||!Number.isFinite(row.finishedAt.getTime())||row.finishedAt>now||
      !(row.startedAt instanceof Date)||!Number.isFinite(row.startedAt.getTime())||row.startedAt>row.finishedAt)throw Error('PORTABLE_SCHEDULE_TIME_INVALID');
    // Use the same tuple, receipt, count, plan and state checks as the public
    // reader. selected remains a historically valid acceptance even when stale.
    const selection=selectPortableSourceSnapshots([plan],[row],{currentTime:now})[0]!;
    if(selection.selected)return {crawledAt:new Date(selection.lastSuccessAt!),successful:true};
    return {crawledAt:row.finishedAt,successful:false,
      portableRetryNotBefore:new Date(nextP0CrawlWindow(row.finishedAt).startsAt)};
  });
}

/** Legacy success is neither current-policy acceptance nor a failed attempt at
 * this policy. Ignore it so it cannot postpone the first policy acquisition. */
function completedLegacySuccess(row:PortableSourceResultRow):boolean {
  const receipt=row.completenessCertificate as {schemaVersion?:unknown;policyId?:unknown}|null;
  const claimsCurrent=receipt?.schemaVersion===SOURCE_QUALITY_RECEIPT_SCHEMA||receipt?.policyId===SOURCE_QUALITY_POLICY_ID||receipt?.schemaVersion===A_GRADE_COMPLETENESS_CERTIFICATE_SCHEMA_VERSION||isCurrentBGradeCertificateSchema(receipt?.schemaVersion);
  return !claimsCurrent&&row.transportState==='SUCCEEDED'&&row.adapterState==='SUCCEEDED'&&
    row.completenessState==='VERIFIED'&&row.atomicCommitState==='COMMITTED'&&
    !row.failureCode&&!row.failureReason&&!row.blockerCode&&!row.blockerReason;
}
