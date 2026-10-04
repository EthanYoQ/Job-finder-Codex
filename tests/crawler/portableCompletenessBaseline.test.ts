import {describe,expect,it} from 'vitest';
import {assertTrustedBaselineTransition,assertTrustedCompletenessBaseline,comparablePortableBaseline,evaluateCompletenessAnomaly,transitionTrustedCompletenessBaseline,type TrustedCompletenessBaseline} from '../../src/crawler/completenessAnomalyPolicy';
const current:TrustedCompletenessBaseline={sourceId:'source-hansoh-social',sourceResultId:'new-result',sourceConfigSha256:'a'.repeat(64),certificateGrade:'PLAN_BOUND_SOURCE_QUALITY_V1',certificateSha256:'b'.repeat(64),certifiedJobCount:40,verifiedAt:'2026-10-01T11:00:00.000Z'};
describe('portable gradeless proof baseline bookkeeping',()=>{
 it('compares only the same source configuration without changing historical rows',()=>{
  expect(comparablePortableBaseline(current,current.sourceId,current.sourceConfigSha256)).toBe(current);
  expect(comparablePortableBaseline(current,current.sourceId,'c'.repeat(64))).toBeNull();
  expect(comparablePortableBaseline(current,'source-other',current.sourceConfigSha256)).toBeNull();
  expect(comparablePortableBaseline(null,current.sourceId,current.sourceConfigSha256)).toBeNull();
  expect(current.certifiedJobCount).toBe(40);
 });
 it.each([[null,'INITIAL'],[30,'INCREASE'],[50,'DECREASE'],[40,'UNCHANGED']] as const)('records the actual count direction for %s', (previousCount,direction)=>{
  const previous=previousCount===null?null:{...current,sourceResultId:'old-result',certifiedJobCount:previousCount,verifiedAt:'2026-10-01T10:00:00.000Z'};
  expect(transitionTrustedCompletenessBaseline({previous,verified:current}).changeReason).toBe(`PLAN_BOUND_REPLAY_CONFIRMED_${direction}`);
 });
 it('does not relabel portable replay as independent B validation',()=>{
  expect(()=>assertTrustedBaselineTransition({previousSourceResultId:null,previousJobCount:null,currentSourceResultId:'new',currentJobCount:40,certificateGrade:'PLAN_BOUND_SOURCE_QUALITY_V1',changeReason:'INDEPENDENT_VALIDATION_CONFIRMED_INITIAL'})).toThrow();
  expect(()=>assertTrustedBaselineTransition({previousSourceResultId:null,previousJobCount:null,currentSourceResultId:'new',currentJobCount:40,certificateGrade:'B',changeReason:'PLAN_BOUND_REPLAY_CONFIRMED_INITIAL'})).toThrow();
 });
 it('retains the large count-drop trigger under the new proof kind',()=>{
  expect(evaluateCompletenessAnomaly({baseline:{...current,certifiedJobCount:100},currentJobCount:40}).triggerCodes).toContain('TRUSTED_COUNT_DROP');
 });
 it('rejects an unknown proof kind rather than treating it as B',()=>{
  expect(()=>assertTrustedCompletenessBaseline({...current,certificateGrade:'unknown'} as never)).toThrow(/proof kind/);
 });
 it('retains source identity, time ordering and count direction checks',()=>{
  expect(()=>transitionTrustedCompletenessBaseline({previous:{...current,sourceResultId:'old',verifiedAt:'2026-10-02T11:00:00.000Z'},verified:current})).toThrow();
  expect(()=>assertTrustedBaselineTransition({previousSourceResultId:'old',previousJobCount:100,currentSourceResultId:'new',currentJobCount:40,certificateGrade:'PLAN_BOUND_SOURCE_QUALITY_V1',changeReason:'PLAN_BOUND_REPLAY_CONFIRMED_INCREASE'})).toThrow();
 });
});
