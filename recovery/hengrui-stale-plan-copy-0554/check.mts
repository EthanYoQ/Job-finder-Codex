import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deriveCurrentStagedScheduleExpectation} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/stagedScheduleAuthority.ts';
import {assertHengruiRefreshPlan} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/native/hengrui-native-capture.mts';
const {build}=JSON.parse(fs.readFileSync('recovery104-work/actual-identity.json','utf8'));
const plan=deriveCurrentStagedScheduleExpectation(build).plans.find(p=>p.source.id==='source-hengrui-social');assert(plan);assertHengruiRefreshPlan(plan);
assert.throws(()=>assertHengruiRefreshPlan({...plan,source:{...plan.source,officialEntryUrl:'https://example.invalid'}}));
assert.throws(()=>assertHengruiRefreshPlan({...plan,moka:{...plan.moka,expectedOrgId:'other'}}));
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const origin='https://app.mokahr.com',endpointSha256=sha(plan.source.officialEntryUrl.split('#')[0]);
const start={origin,endpointSha256,hasQuery:false,requestUrlSha256:sha(plan.source.officialEntryUrl)};
function verify(next:any){assert.equal(start.requestUrlSha256,sha(plan!.source.officialEntryUrl));const u=new URL(plan!.source.officialEntryUrl);u.hash='';assert.equal(next.requestUrlSha256,sha(u.href));assert.deepEqual({...start,requestUrlSha256:next.requestUrlSha256},next);}
verify({...start,requestUrlSha256:endpointSha256});assert.throws(()=>verify({...start,requestUrlSha256:sha('https://app.mokahr.com/other')}));assert.throws(()=>verify({...start,origin:'https://other.invalid',requestUrlSha256:endpointSha256}));console.log('PASS: exact derived plan and fragment-only redirect; wrong plan/URL/origin rejected');
