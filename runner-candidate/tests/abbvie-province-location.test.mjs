import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAbbvieChinaRowScope,reviewedAbbvieCity} from '../src/crawler/abbvieChinaRowScope.ts';
import {htmlTableAdapter} from '../src/crawler/adapters/htmlTable.ts';
import {profile_abbvie_china} from '../src/crawler/companyRecruitmentProfiles/profiles/abbvie-china.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';

const row=(location,option)=>`<div class="attrax-vacancy-tile">
<a class="attrax-vacancy-tile__title" href="/zh-hans/job/test-jid-123">Test role</a>
<div class="attrax-vacancy-tile__location-freetext"><span class="attrax-vacancy-tile__item-value">${location}</span></div>
<div class="attrax-vacancy-tile__option-location attrax-vacancy-tile__option-location--${option.toLowerCase()}"><span class="attrax-vacancy-tile__item-value">${option}</span></div>
<div class="attrax-vacancy-tile__option-job-type"><span class="attrax-vacancy-tile__item-value">Full-time</span></div>
<span class="attrax-vacancy-tile__expiry-value">01/01/0001</span></div>`;
const extract=html=>htmlTableAdapter.extract({html,table:profile_abbvie_china.sources[0].executionConfig.table,
 company:{id:'company-abbvie-china',officialChineseName:'艾伯维'},
 source:{id:'source-abbvie-china-social',companyId:'company-abbvie-china',kind:'SOCIAL',atsKind:'OFFICIAL_HTML',status:'VERIFIED',officialEntryUrl:'https://careers.abbvie.com/zh-hans/jobs'},
 capturedAt:'2026-11-02T05:03:00.000Z'});

test('official Guangdong province-only location preserves raw geography and has no invented city',()=>{
 const html=row('Guangdong, GD','Guangdong');
 assert.equal(validateAbbvieChinaRowScope(html),true);
 assert.equal(reviewedAbbvieCity('Guangdong, GD'),undefined);
 const result=extract(html);
 assert.equal(result.jobs.length,1);
 assert.equal(result.jobs[0].locationRaw,'Guangdong, GD');
 assert.deepEqual(result.jobs[0].cities,[CITY_PENDING]);
});
test('city rows retain their city beside a province-only row',()=>{
 const html=row('Guangdong, GD','Guangdong')+row('Shanghai, Shanghai','Shanghai').replaceAll('jid-123','jid-124');
 assert.equal(validateAbbvieChinaRowScope(html),true);
 assert.deepEqual(extract(html).jobs.map(j=>j.cities),[[CITY_PENDING],['上海']]);
});
test('unknown, foreign and conflicting province labels remain outside the accepted scope',()=>{
 for(const [location,option] of [['Guangdong, XX','Guangdong'],['Guangdong, GD','Hong Kong'],['Hong Kong, HK','Hong Kong'],['Taipei, Taiwan','Taipei'],['Unknown, GD','Unknown'],['Taipei, Henan','China'],['Beijing, Guangdong Province','China'],['Deyang, Sichuan','Henan'],['Guiyang, Henan','China'],['Hohhot, Henan','China'],['Shenyang, Sichuan','China'],['Baotou, Henan','China'],['Henan Province, Sichuan','China']])
  assert.equal(validateAbbvieChinaRowScope(row(location,option)),false,location+' / '+option);
});
test('official mainland province admits new city labels without inventing a city',()=>{
 for(const [location,option] of [['Puyang, Henan','China'],['Deyang, Sichuan','Sichuan'],['Tongren, Guizhou','China'],['Sanya, Hainan','China']]){
  const html=row(location,option);assert.equal(validateAbbvieChinaRowScope(html),true);
  const result=extract(html);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].locationRaw,location);
  assert.deepEqual(result.jobs[0].cities,[CITY_PENDING]);
 }
});
