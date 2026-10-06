// NONQUALIFYING SYNTHETIC CHECKS. No browser or network is invoked.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {checkListReadiness, waitForListReadiness} = require('./list-readiness-proposal.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = 'https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const base = {
  keyword: '', url: canonical, heading: 'Displaying 1 to 20 of 106 matching jobs', resultCount: '106',
  filters: ['team','subteam','country','state','location','type','pattern'].map(name => ({id: 'l-' + name, name, selectedOptions: name === 'country' ? [{text:'China',value:'China'}] : []})),
  identities: Array.from({length:20}, (_,i) => ({officialId:'r-' + (900000+i), links:[{title:'SYNTHETIC ONLY ' + i,url:'https://www.careers.jnj.com/en/jobs/r-' + (900000+i) + '/synthetic-only/'}]})),
  pagination:[{label:'Page 1',url:canonical},{label:'Page 6',url:'https://www.careers.jnj.com/en/jobs/?page=6&country=China&origin=global#results'},{label:'Next page',url:'https://www.careers.jnj.com/en/jobs/?page=2&country=China&origin=global#results'}],
};
const results = [];
function test(name, mutate, expectedReason, page=1, total=106) {
  const state=clone(base);mutate(state);
  const result=checkListReadiness(state,page,total);
  if (expectedReason) {assert.equal(result.ready,false);assert.ok(result.reasons.includes(expectedReason),JSON.stringify(result));}
  else assert.equal(result.ready,true,JSON.stringify(result));
  results.push({name,passed:true,ready:result.ready,reasons:result.reasons});
}
test('correct_china_page_is_ready',()=>{},null);
test('nonempty_keyword_rejected',s=>{s.keyword='medical affairs';},'KEYWORD_NOT_EMPTY');
test('country_cleared_rejected',s=>{s.filters[2].selectedOptions=[];},'FILTER_country');
test('extra_team_selection_rejected',s=>{s.filters[0].selectedOptions=[{text:'Quality',value:'Quality'}];},'FILTER_team');
test('observed_failure_shape_rejected',s=>{s.keyword='medical affairs';s.filters[0].selectedOptions=['Career Programs','Quality','Regulatory Affairs Group'].map(x=>({text:x,value:x}));s.filters[2].selectedOptions=[];s.heading='Displaying 1 to 20 of 291 matching jobs';s.resultCount='291';},'KEYWORD_NOT_EMPTY');
test('wrong_page_range_rejected',()=>{},'PAGE_RANGE_MISMATCH',2);
test('heading_and_native_count_disagree',s=>{s.resultCount='107';},'HEADING_RESULT_ATTRIBUTE_MISMATCH');
test('incomplete_cards_rejected',s=>{s.identities.pop();},'CARD_COUNT_MISMATCH');
test('duplicate_id_rejected',s=>{s.identities[1]=clone(s.identities[0]);},'DUPLICATE_ID');
test('missing_native_next_page_rejected',s=>{s.pagination.pop();},'NEXT_PAGE_MISMATCH');
test('filter_order_mismatch_rejected',s=>{s.filters.reverse();},'FILTER_SET_OR_ORDER');
test('changed_total_rejected',s=>{s.heading='Displaying 1 to 20 of 107 matching jobs';s.resultCount='107';},'TOTAL_CHANGED');
test('source_contract_limit_preserved',s=>{s.heading='Displaying 1 to 20 of 401 matching jobs';s.resultCount='401';},'TOTAL_OUTSIDE_ORIGINAL_CONTRACT');

(async()=>{
  const calls=[];
  const tab={playwright:{
    locator:selector=>({waitFor:async options=>{calls.push({action:'scope-wait',selector,timeoutMs:options.timeoutMs});}}),
    getByRole:(role,options)=>role==='heading'?{waitFor:async config=>{calls.push({action:'heading-wait',timeoutMs:config.timeoutMs});}}:{evaluate:async(fn,arg,config)=>{calls.push({action:'read-state',timeoutMs:config.timeoutMs});return clone(base);}},
  }};
  const result=await waitForListReadiness(tab,1,106,15000);
  assert.equal(result.qualifyingCapture,false);assert.equal(result.result.ready,true);
  assert.deepEqual(calls.map(c=>c.action),['scope-wait','heading-wait','read-state']);
  assert.ok(calls.every(c=>c.timeoutMs>0&&c.timeoutMs<=15000));
  results.push({name:'bounded_supported_waits_then_single_read',passed:true,actions:calls.map(c=>c.action)});
  let laterReads=0;
  const stuckTab={playwright:{locator:()=>({waitFor:async()=>{throw new Error('SYNTHETIC scope wait timeout');}}),getByRole:()=>{laterReads++;throw new Error('must not read after timeout');}}};
  await assert.rejects(()=>waitForListReadiness(stuckTab,1,106,15000),/SYNTHETIC scope wait timeout/);
  assert.equal(laterReads,0);results.push({name:'timeout_stops_without_refresh_or_further_read',passed:true});
  const report={kind:'NONQUALIFYING_SYNTHETIC_LIST_READINESS_TESTS',qualifyingCapture:false,browserCalls:0,networkCalls:0,passed:results.length,cases:results,proposalSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'list-readiness-proposal.cjs'))).digest('hex')};
  fs.writeFileSync(path.join(__dirname,'NONQUALIFYING-readiness-tests.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,proposalSha256:report.proposalSha256}));
})().catch(error=>{console.error(error);process.exitCode=1;});
