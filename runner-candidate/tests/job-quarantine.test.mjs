import test from 'node:test';
import assert from 'node:assert/strict';
import {quarantinedPriorJobKeys,sameNovartisRequisition,restoreQuarantinedList} from '../src/crawler/jobQuarantine.ts';
import {sanitizeEvidenceHttpUrl} from '../src/crawler/sourceFetchEvidence.ts';

const previous=[
 {dedupeKey:'one',record:{sourceJobId:'ID-1',officialUrl:'https://careers.example/job/one'}},
 {dedupeKey:'two',record:{sourceJobId:'ID-2',officialUrl:'https://careers.example/job?id=2'}}
];
test('identified job failures preserve only the matching prior job; an unbound row proves no disappearance',()=>{
 const q={rawLocator:'page-0#row-1',pageSequence:0,recordIndex:1,validJobId:'row-1',code:'JOB_DETAIL_UNAVAILABLE'};
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[{...q,sourceJobId:'ID-1'}]},previous)],['one']);
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[{...q,officialUrl:sanitizeEvidenceHttpUrl(previous[1].record.officialUrl)}]},previous)],['two']);
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[{...q,sourceJobId:'NEW-ID'}]},previous)],[]);
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[q]},previous)],['one','two']);
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[q]},previous,new Set(['one']))],['two']);
 assert.deepEqual([...quarantinedPriorJobKeys({},previous)],[]);
});

test('Workday retains the same native requisition when the title slug changes, without matching another site or ID',()=>{
 const old=[{dedupeKey:'old-path',record:{sourceJobId:'workday:sha256:'+'a'.repeat(64),officialUrl:'https://tenant.myworkdayjobs.com/external/job/Shanghai/Old-title_REQ123-1'}}];
 const q={pageSequence:0,recordIndex:0,rawLocator:'page#row:0',validJobId:'q',code:'JOB_DETAIL_UNAVAILABLE',sourceJobId:'workday:sha256:'+'b'.repeat(64),officialUrl:'https://tenant.myworkdayjobs.com/external/job/Shanghai/New-title_REQ123-1'};
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[q]},old)],['old-path']);
 for(const url of [q.officialUrl.replace('REQ123','REQ124'),q.officialUrl.replace('/external/','/other-site/'),q.officialUrl.replace('tenant.','other.')])
  assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[{...q,officialUrl:url}]},old)],[]);
});

test('same native Novartis requisition remains bound when its title slug changes',()=>{
 const old='https://www.novartis.com.cn/careers/career-search/job/details/req-12345-old-title',fresh=old.replace('old-title','new-title');
 assert.equal(sameNovartisRequisition(old,fresh),true);
 for(const url of [fresh.replace('12345','12346'),fresh.replace('www.novartis.com.cn','other.invalid'),fresh+'?id=1',fresh+'#other'])assert.equal(sameNovartisRequisition(old,url),false);
 assert.deepEqual([...quarantinedPriorJobKeys({jobQuarantines:[{officialUrl:fresh}]},[{dedupeKey:'old',record:{officialUrl:old}}])],['old']);
});

test('restoring an isolated HTML row keeps its physical list order',()=>{
 const artifact={id:'list',logicalKey:'list',kind:'ATS_PAGE',requestedUrl:'https://example.invalid/list',finalUrl:'https://example.invalid/list',httpStatus:200,contentType:'text/html',extractorLocator:'synthetic',body:'synthetic',capturedAt:'2026-11-06T00:00:00.000Z'};
 const evidence={captureTool:{name:'test',version:'1'},artifacts:[artifact],pages:[{sequence:0,artifactLogicalKey:'list',rawJobIds:['one','two','three'],validJobIds:['one','three'],termination:'NEXT_ABSENT',anomalyCodes:[],capturedAt:artifact.capturedAt}],fetchCounts:{rawCount:3,parsedCount:3,validCount:2,parseDiscardCount:0,validationDiscardCount:1},fetchLosses:[{stage:'VALIDATION',reason:'Unknown',rawLocator:'list#row:1',details:{code:'JOB_QUARANTINED'}}],jobQuarantines:[{rawLocator:'list#row:1',pageSequence:0,recordIndex:1,validJobId:'two',code:'JOB_ROW_NORMALIZATION_FAILED'}]};
 assert.deepEqual(restoreQuarantinedList(evidence).pages[0].validJobIds,['one','two','three']);
});
