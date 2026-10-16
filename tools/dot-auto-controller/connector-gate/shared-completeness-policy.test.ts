/** Pure projection-equivalence tests. Compiler/receipt qualification is covered
 * separately by shared-completeness-guard and genuine A/B integration tests. */
import {expect,it} from 'vitest';
import {evaluateCompletenessAnomalyForCrawl} from '../vendor/c60-source/src/crawler/completenessAnomalyPolicy.ts';
import {buildStagedSourceCrawlPlans,type SourceCrawlPlan} from '../vendor/c60-source/src/crawler/sourcePlan.ts';
import {candidateCompanies} from '../vendor/c60-source/src/data/companyRegistry.ts';
import type {SourceCrawlResult} from '../vendor/c60-source/src/crawler/runSourceCrawl.ts';
const plans=buildStagedSourceCrawlPlans(candidateCompanies);
const plan=plans.find(p=>p.source.id==='source-hengrui-social')!;
function result(input:{count?:number;pages?:unknown[];codes?:string[]}={}):SourceCrawlResult{
 return {jobs:Array.from({length:input.count??1},()=>({})),...(input.pages?{fetchEvidence:{pages:input.pages}}:{}),...(input.codes?{paginationEvaluation:{derivedAnomalyCodes:input.codes}}:{})} as unknown as SourceCrawlResult;
}
const page=(patch:Record<string,unknown>={})=>({returnedPageSize:50,requestedPageSize:50,nextPageSignalAfter:null,termination:'NEXT_ABSENT',...patch});
it('genuine null baseline has no count comparator and missing evidence adds no invented pagination fact',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result(),null)).toEqual({independentValidationRequired:false,triggerCodes:[],countChange:null});
});
it.each(['REPEATED_RESPONSE_FINGERPRINT','REPEATED_JOB_ID_SET_WITH_NEXT','CURSOR_NOT_ADVANCING','OFFSET_NOT_ADVANCING','MAX_PAGES_WITH_NEXT','EXPECTED_CHANNEL_NOT_VISITED'])('retains original pagination anomaly %s even with null baseline',code=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({codes:[code]}),null).triggerCodes).toContain('PAGINATION_'+code);
});
it('ignores unrelated pagination codes exactly as the original evaluator',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({codes:['UNRELATED']}),null).triggerCodes).toEqual([]);
});
it.each(['NEXT_ABSENT','EMPTY_PAGE','DECLARED_TOTAL_REACHED'])('only original proven terminal %s permits a full final page',termination=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[page({termination})]}),null).triggerCodes).toEqual([]);
});
it('keeps both next-signal and full-page risks on the final page',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[page({nextPageSignalAfter:'next',termination:'NEXT_PRESENT'})]}),null).triggerCodes).toEqual(['LAST_PAGE_WITH_NEXT_SIGNAL','FULL_LAST_PAGE_WITHOUT_TERMINAL']);
});
it('does not treat an unproved termination string as terminal',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[page({termination:'MAX_PAGES'})]}),null).triggerCodes).toEqual(['FULL_LAST_PAGE_WITHOUT_TERMINAL']);
});
it('preserves undefined next-signal semantics instead of normalizing it to null',()=>{
 const final:Record<string,unknown>=page();delete final.nextPageSignalAfter;
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[final]}),null).triggerCodes).toEqual(['LAST_PAGE_WITH_NEXT_SIGNAL','FULL_LAST_PAGE_WITHOUT_TERMINAL']);
});
it('keeps null/missing page sizes without inventing a full page',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[page({returnedPageSize:null,requestedPageSize:null,termination:'MAX_PAGES'})]}),null).triggerCodes).toEqual([]);
});
it('uses only final page terminal evidence',()=>{
 expect(evaluateCompletenessAnomalyForCrawl(plan,result({pages:[page({nextPageSignalAfter:'next'}),page({returnedPageSize:1})]}),null).triggerCodes).toEqual([]);
});
it('retains html exact-maxPages adapter capacity and excludes nonhtml/short traversal',()=>{
 const html=structuredClone(plans.find(p=>p.adapterId==='html-table')!) as SourceCrawlPlan;
 if(html.adapterId!=='html-table')throw Error('REAL_HTML_PLAN_REQUIRED');
 html.table.pagination={...html.table.pagination,pageSize:50,maxPages:2} as typeof html.table.pagination;
 const two=result({count:100,pages:[page(),page()]});
 expect(evaluateCompletenessAnomalyForCrawl(html,two,null).triggerCodes).toContain('SUSPICIOUS_ADAPTER_CAPACITY_REACHED');
 expect(evaluateCompletenessAnomalyForCrawl(plan,two,null).triggerCodes).toEqual([]);
 expect(evaluateCompletenessAnomalyForCrawl(html,result({count:100,pages:[page()]}),null).triggerCodes).toEqual([]);
});
