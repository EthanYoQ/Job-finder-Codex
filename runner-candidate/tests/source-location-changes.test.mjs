import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isHengruiMainlandLocation} from '../src/crawler/hengruiMainlandGeography.ts';
import {lillyOfficialCities,lillyNativeDetail} from '../src/crawler/lillyChinaQuality.ts';
import {organonOfficialCities,organonOfficialIdentity} from '../src/crawler/organonChinaQuality.ts';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}-location-change.json`,import.meta.url)));

test('Hengrui accepts official mainland county IDs without enumerating every county',()=>{
 const location={country:'中国',provinceName:'广东',provinceId:440000,cityName:'台山市',cityId:440781};
 assert(isHengruiMainlandLocation(location));
 assert(isHengruiMainlandLocation({...location,provinceName:'江苏',provinceId:320000,cityName:'新北区',cityId:320411}));
 for(const delta of [{cityId:undefined},{cityId:810000},{provinceId:810000},{provinceName:'香港'},
  {cityName:'香港'},{cityName:'台湾'},{cityName:'台灣'},{cityName:'新加坡'},{cityName:'东京'},{cityName:'台北'},{country:'United States'}])assert.equal(isHengruiMainlandLocation({...location,...delta}),false);
});
test('Lilly accepts a new China apply token while leaving its city pending',()=>{
 const raw=fixture('lilly');assert.deepEqual(lillyOfficialCities(raw),[CITY_PENDING]);
 for(const token of ['China-Hong-Kong-','China-HongKong-','Singapore','China-Taiwan-','China-Taipei-','China-Tai-Pei-','China-Kaohsiung-']){
  assert.equal(lillyOfficialCities({...raw,applyUrl:raw.applyUrl.replace('China-Bao-Ding-',token)}),undefined);
 }
 assert.equal(lillyOfficialCities({...raw,applyUrl:raw.applyUrl.replace(raw.reqId,'R-000000')}),undefined);
});
test('Lilly native detail retains unknown city and rejects explicit foreign geography',()=>{
 const raw=fixture('lilly'),start='2026-11-02T17:00:00.000Z';
 const job={ '@type':'JobPosting',identifier:{value:raw.reqId},title:raw.title,description:'Role',datePosted:'2026-11-02',jobLocation:{address:{addressCountry:'China',addressLocality:'Bao Ding'}}};
 const artifact=()=>({logicalKey:`lilly-detail-${raw.reqId}`,kind:'OFFICIAL_COMPANY_PAGE',extractorLocator:'lilly-workday-jobposting-v1',requestedUrl:raw.applyUrl,finalUrl:raw.applyUrl,httpStatus:200,contentType:'text/html',capturedAt:start,bodyRepresentation:'EXACT',body:`<script>window.workday = {postingAvailable:true};</script><script type="application/ld+json">${JSON.stringify(job)}</script>`});
 assert.deepEqual(lillyNativeDetail(raw,artifact(),start),{status:'ACTIVE',cities:[CITY_PENDING],locationRaw:'Bao Ding, China'});
 for(const place of ['Hong Kong','HongKong','Taipei','Tai Pei','Kaohsiung','台北','高雄']){
  job.jobLocation.address.addressLocality=place;assert.equal(lillyNativeDetail(raw,artifact(),start),undefined);
 }
});
test('Organon reuses known mainland city/province pairs and permits absent optional workLocation',()=>{
 const raw=fixture('organon');assert(organonOfficialIdentity(raw));assert.deepEqual(organonOfficialCities(raw),[CITY_PENDING]);
 for(const delta of [{country:'United States'},{state:'Unknown'},{city:'Hong Kong'},
  {applyUrl:raw.applyUrl.replace('CHN---Henan---Zhengzhou','CHN---Hong-Kong---Hong-Kong')},
  {applyUrl:raw.applyUrl.replace(raw.reqId,'R000000')}])assert.equal(organonOfficialCities({...raw,...delta}),undefined);
});
