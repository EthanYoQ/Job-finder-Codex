import test from 'node:test';
import assert from 'node:assert/strict';
import {quarantinedPriorJobKeys} from '../src/crawler/jobQuarantine.ts';
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
