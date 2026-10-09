import { describe, expect, it, vi } from 'vitest';
import { createPrismaCrawlRuntimeDeps } from '../../src/db/crawlRuntimeRepository';
import { toSourceScheduleState } from '../../src/db/crawlStateRepository';
import { isSourceDueForScheduledRun } from '../../src/crawler/schedule';
import { sourcePlanConfigSha256 } from '../../src/crawler/sourcePlan';
import { accepted, failed, unstartedAbort, ambiguousAbortMutations, plan, NOW } from '../helpers/portablePublicSnapshotFixture';
import type { PortableSourceResultRow } from '../../src/db/portablePublicSnapshotRepository';
function setup(rows:PortableSourceResultRow[]) {
 const legacy=vi.fn(async()=>[{crawledAt:new Date('2026-10-01T11:59:00Z'),successful:true}]);
 const findMany=vi.fn(async(args: {take?: number})=>args.take === undefined ? rows : rows.slice(0,args.take));
 const db={crawlObservation:{findMany:legacy},crawlBatchSourceResult:{findMany},job:{}} as any;
 const deps=createPrismaCrawlRuntimeDeps(db,{portablePlans:[plan],now:()=>NOW});
 return {deps,legacy,findMany,db};
}
async function state(rows:PortableSourceResultRow[]){const s=setup(rows);return toSourceScheduleState(plan.source.id,await s.deps.getRecentObservations(plan.source.id));}
describe('portable current-policy scheduling observations',()=>{
 it('makes a new configuration due despite fresh success under the old configuration',async()=>{
  const old=accepted('2026-10-01T11:59:00.000Z').result;old.sourceConfigHash='0'.repeat(64);
  const s=setup([old]);expect(isSourceDueForScheduledRun(toSourceScheduleState(plan.source.id,await s.deps.getRecentObservations(plan.source.id)),NOW)).toBe(true);
  expect(s.legacy).not.toHaveBeenCalled();
  expect(s.findMany.mock.calls[0]![0]).toMatchObject({select: {fetchAttemptCount: true, retryCount: true, failureDiagnosticCode: true, _count: {select: {transportAttempts: true, evidenceArtifacts: true}}}});
  expect(s.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{sourceId:plan.source.id,sourceConfigHash:sourcePlanConfigSha256(plan),batch:{is:{kind:'SCHEDULED'}},finishedAt:{not:null},OR:[{transportState:{not:'SKIPPED'}},{failureCode:'BATCH_ABORTED_BEFORE_SOURCE_TERMINAL'}]}}));
 });
 it('does not repeat an accepted current-configuration crawl early, but is due in the next regular window',async()=>{
  const s=await state([accepted('2026-10-01T11:00:00.000Z').result]);
  expect(s.lastSuccessfulCrawlAt).toEqual(new Date('2026-10-01T11:00:00.000Z'));
  expect(isSourceDueForScheduledRun(s,NOW)).toBe(false);
  expect(isSourceDueForScheduledRun(s,new Date('2026-10-01T16:01:00.000Z'))).toBe(true);
 });
 it('keeps failures unsuccessful and backs off until the next window even without any accepted history',async()=>{
  const s=await state([failed('2026-10-01T11:59:00.000Z')]);
  expect(s.lastSuccessfulCrawlAt).toBeUndefined();expect(s.consecutiveFailureCount).toBe(1);
  expect(isSourceDueForScheduledRun(s,NOW)).toBe(false);
  expect(isSourceDueForScheduledRun(s,new Date('2026-10-01T16:00:59.999Z'))).toBe(false);
  expect(isSourceDueForScheduledRun(s,new Date('2026-10-01T16:01:00.000Z'))).toBe(true);
 });
 it('does not let three consecutive failures bypass the portable retry boundary',async()=>{
  const s=await state(['11:59','11:58','11:57'].map(t=>failed(`2026-10-01T${t}:00.000Z`)));
  expect(s.consecutiveFailureCount).toBe(3);expect(isSourceDueForScheduledRun(s,NOW)).toBe(false);
 });
 it.each(['changed counts','uncommitted','bad receipt hash'])('does not count %s as successful current-policy history',async(kind)=>{
  const row=accepted('2026-10-01T11:00:00.000Z').result;
  if(kind==='changed counts')row.validCount++;
  if(kind==='uncommitted')row.atomicCommitState='FAILED';
  if(kind==='bad receipt hash')row.completenessCertificateSha256='0'.repeat(64);
  const s=await state([row]);expect(s.lastSuccessfulCrawlAt).toBeUndefined();expect(s.consecutiveFailureCount).toBe(1);
 });

 it('ignores a completed legacy success so the first current-policy acquisition is due now',async()=>{
  const legacy=accepted('2026-10-01T11:59:00.000Z').result;legacy.completenessCertificate={grade:'B'};
  const s=await state([legacy]);expect(s.lastSuccessfulCrawlAt).toBeUndefined();expect(s.consecutiveFailureCount).toBe(0);
  expect(s.retryNotBefore).toBeUndefined();expect(isSourceDueForScheduledRun(s,NOW)).toBe(true);
 });
 it('keeps malformed current-policy claims as failures, rather than treating them as legacy success',async()=>{
  const row=accepted('2026-10-01T11:59:00.000Z').result;row.completenessCertificate={policyId:'PLAN_BOUND_SOURCE_QUALITY_V1'};
  const s=await state([row]);expect(s.consecutiveFailureCount).toBe(1);expect(isSourceDueForScheduledRun(s,NOW)).toBe(false);
 });
 it('ignores manual, pending, skipped and other-source results instead of delaying a new configuration',async()=>{
  const rows=Array.from({length:4},()=>accepted('2026-10-01T11:00:00.000Z').result);
  rows[0]!.batch.kind='MANUAL_SOURCE';rows[1]!.finishedAt=null;rows[2]!.transportState='SKIPPED';rows[2]!.failureCode='SOURCE_NOT_DUE';rows[3]!.sourceId='other';
  const s=await state(rows);expect(s.consecutiveFailureCount).toBe(0);expect(isSourceDueForScheduledRun(s,NOW)).toBe(true);
 });
 it.each(['FAILED', 'SKIPPED'] as const)('ignores proven unstarted %s closure without creating retry backoff', async transport => {
  const row = unstartedAbort(undefined, transport), before = structuredClone(row);
  const s = await state([row]);
  expect(s.consecutiveFailureCount).toBe(0); expect(s.retryNotBefore).toBeUndefined();
  expect(isSourceDueForScheduledRun(s, NOW)).toBe(true); expect(row).toEqual(before);
 });
 it.each(ambiguousAbortMutations)('retains ambiguous abort with %s as a failed attempt', async (_name, mutate) => {
  for (const transport of ['FAILED', 'SKIPPED'] as const) {
   const row = unstartedAbort(undefined, transport); mutate(row);
   const s = await state([row]); expect(s.consecutiveFailureCount).toBe(1);
   expect(isSourceDueForScheduledRun(s, NOW)).toBe(false);
  }
 });
 it('retains a real failure behind neutral aborts', async () => {
  const s = await state([...Array.from({length: 11}, () => unstartedAbort()), failed()]);
  expect(s.consecutiveFailureCount).toBe(1); expect(s.retryNotBefore).toBeDefined();
 });
 it('preserves legacy non-portable queries and leaves their schedule semantics unchanged',async()=>{
  const s=setup([]);const deps=createPrismaCrawlRuntimeDeps(s.db);const rows=await deps.getRecentObservations(plan.source.id);
  expect(s.legacy).toHaveBeenCalledOnce();expect(s.findMany).not.toHaveBeenCalled();expect(rows).toEqual([{crawledAt:new Date('2026-10-01T11:59:00Z'),successful:true}]);
 });
});
