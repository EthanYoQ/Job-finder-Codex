import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CITY_PENDING} from '../src/domain/jobLocation.ts';
import {bmsMainlandCities} from '../src/crawler/bmsMainlandGeography.ts';
import {biogenListCities} from '../src/crawler/biogenListGeographyGuard.ts';
import {projectAmgenNativeCities,parseWorkdayMainlandRow} from '../src/crawler/workdayMainlandQuality.ts';
import {ucbOfficialCities} from '../src/crawler/ucbOfficialPostedDate.ts';
import {merckOfficialCities} from '../src/crawler/merckChinaQuality.ts';
import {lillyOfficialCities} from '../src/crawler/lillyChinaQuality.ts';
import {organonOfficialCities} from '../src/crawler/organonChinaQuality.ts';
import {phenomMainlandGeography} from '../src/crawler/phenomMainlandGeography.ts';
import {biDisplayCities} from '../src/crawler/biSemanticCompleteness.ts';
import {mokaPublishedAtIso} from '../src/crawler/mokaSourceFetch.ts';
import {parseAstellasLocationPages} from '../src/crawler/astellasPdfLocations.ts';
import {hasExactFosunMainlandGeography} from '../src/crawler/fosunScopeGeography.ts';
import {qiluReviewedRowGeography} from '../src/crawler/manualChromeQiluReplay.ts';
import {classifyKelunLocation} from '../src/crawler/kelunMainlandScope.ts';
import {beisenDomesticRecordScopeReview} from '../src/crawler/officialJsonSourceFetch.ts';
import {hasMainlandCountryLocation,mokaDisplayCities} from '../src/crawler/hengruiMainlandGeography.ts';
import {classifyGileadPublicAge,gileadPublicAgeEvidenceSchema} from '../src/crawler/gileadPublicAge.ts';
const pending=[CITY_PENDING],fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}-location-change.json`,import.meta.url)));

test('country-qualified new cities survive without inventing a canonical city',()=>{
 assert.deepEqual(bmsMainlandCities({locations:['Puyang - CN'],standardizedLocations:['Puyang, Henan, CN'],workLocationOption:'hybrid',displayBadge:'New'}),pending);
 assert.deepEqual(projectAmgenNativeCities('Role',['China - Puyang'],'China - Puyang'),pending);
 assert.deepEqual(ucbOfficialCities('Newtown, Qinghai, China',undefined),pending);
 assert.equal(ucbOfficialCities('Tokyo, China','Tokyo'),undefined);
 const biogen={title:'Role',locationsText:'Newtown, China',externalPath:'/job/Newtown-China/Role_REQ123-1',bulletFields:['REQ123'],displayBadge:'New'};
 assert.deepEqual(biogenListCities(biogen),pending);
 assert.equal(biogenListCities({...biogen,locationsText:'Tokyo, China'}),undefined);
 const shanghai={...biogen,locationsText:'Shanghai, China',externalPath:'/job/Shanghai-China/Role_REQ123-1'};
 for(const title of ['Role 工作地点：东京','Role Location: Tokyo','Role (Location: Tokyo)','Role （LOCATION：Tokyo）'])assert.equal(biogenListCities({...shanghai,title}),undefined,title);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role 工作地点：新城区'}),pending);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role (Location: Shanghai)'}),['上海']);
 const csl={title:'Role',externalPath:'/job/APAC-CN-Puyang-CSL-Behring/Role_R-123',locationsText:'APAC, CN, Puyang, CSL Behring',bulletFields:['Temporary','R-123','Sales','China'],timeType:'Part time',displayBadge:'New'};
 assert(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},csl));
 for(const bulletFields of [['China','R-123'],['Sales','China','Part time','R-123','New badge']])assert(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields}));
 for(const bulletFields of [['Sales','R-123'],['China'],['China','R-123','R-456'],['China','R-456'],['China','China','R-123']])assert.equal(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields}),undefined);
 assert.equal(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields:['Temporary','R-123','Sales','Japan']}),undefined);
});

test('Phenom optional presentation, coordinates and addresses do not control admission',()=>{
 const lilly=fixture('lilly'),organon=fixture('organon');
 for(const delta of [{dateCreated:'unknown'},{displayBadge:'New'},{latitude:'31.22223'},{address:'New street, Shanghai, China'}])assert(lillyOfficialCities({...lilly,...delta}));
 assert(organonOfficialCities({...organon,address:'New street, Chengdu, Sichuan, China',displayBadge:'New'}));
 const merck={title:'Role',country:'China',city:'Puyang',state:'Henan',location:'Puyang, Henan, China',latitude:'unknown'};
 assert.deepEqual(merckOfficialCities(merck),pending);
 assert.equal(merckOfficialCities({...merck,country:'Japan'}),undefined);
 assert.equal(phenomMainlandGeography({...merck,multi_location_array:[{country:'China',location:'Puyang, Henan, China',stateCountry:'Tokyo, Japan'}]}),false);
 assert.deepEqual(merckOfficialCities({...merck,city:'Shanghai',state:'Shanghai',location:'Beijing, Beijing, China'}),pending);
 assert.deepEqual(merckOfficialCities({...merck,city:'Shanghai',state:'Shanghai',location:'Shanghai, Shanghai, China',multi_location_array:[{country:'China',location:'Shanghai, Shanghai, China',city:'Beijing',state:'Beijing'}]}),pending);
 assert.equal(merckOfficialCities({...merck,title:'Role 工作城市：东京'}),undefined);
 assert.equal(organonOfficialCities({...organon,workLocation:'CHN - Hong Kong'}),undefined);
 assert.deepEqual(merckOfficialCities({...merck,city:'Shanghai',state:'Shanghai',location:'Shanghai, Shanghai, China',multi_location_array:[{country:'China',location:'Shanghai, Shanghai, China',mapQueryLocation:'Beijing, Beijing, China'}]}),pending);
 assert.deepEqual(biDisplayCities({jobareaname:'上海',ejobareaname:'Beijing'}),pending);
 assert.deepEqual(biDisplayCities({jobareaname:'上海',workareaname:'静安区',ejobareaname:'Shanghai-Jingan',eworkareaname:'Shanghai-Jingan'}),pending);
});

test('PDF page position is irrelevant; explicit China is required for an unknown locality',()=>{
 assert.deepEqual(parseAstellasLocationPages(['Role','Location: Newtown, China']).cities,pending);
 assert.equal(parseAstellasLocationPages(['Location: Newtown']).status,'UNREVIEWED_LOCATION');
 assert.equal(parseAstellasLocationPages(['Location: Tokyo, China']).status,'UNREVIEWED_LOCATION');
 assert.equal(parseAstellasLocationPages(['Location: Shanghai','Location: Beijing']).status,'UNREVIEWED_LOCATION');
});

test('domestic scope uses country or province evidence without fixed county or job-ID exceptions',()=>{
 for(const raw of [{LocNames:['青海省·新城区']},{Country:'China',LocNames:['Unmapped locality']},{LocNames:['江苏省·淮安市·新城区']}]){
  assert(hasExactFosunMainlandGeography(raw));assert.equal(qiluReviewedRowGeography(raw),'EXPLICIT_MAINLAND');
  assert.equal(beisenDomesticRecordScopeReview(raw.Country,raw.LocNames,raw.LocNames.join(' / '),'DOMESTIC_OFFICIAL_TENANT').scope,'CHINA');
 }
 assert.equal(classifyKelunLocation('全国'),'MAINLAND');
 assert.equal(classifyKelunLocation('四川省·成都市·新城区'),'MAINLAND');
 for(const raw of [{LocNames:['Unmapped locality']},{Country:'China',LocNames:['新加坡']},{LocNames:['江苏省·东京']},{Country:'Japan',LocNames:['上海']}])assert.equal(hasExactFosunMainlandGeography(raw),false);
 assert(hasMainlandCountryLocation({country:'中国',cityName:'新城区',provinceName:'青海'}));
 assert.deepEqual(mokaDisplayCities([{country:'中国',cityName:'新城区',provinceName:'青海'}]),pending);
 assert.equal(hasMainlandCountryLocation({country:'中国',cityName:'东京'}),false);
 assert.equal(hasMainlandCountryLocation({cityName:'新城区'}),false);
});

test('unrecognized display age stays unknown instead of rejecting the job',()=>{
 assert.equal(mokaPublishedAtIso('2026-11-03 25:61:00'),undefined);
 assert.deepEqual(classifyGileadPublicAge('Recently posted'),{kind:'UNKNOWN'});
 assert.deepEqual(classifyGileadPublicAge(''),{kind:'UNKNOWN'});
 assert.deepEqual(classifyGileadPublicAge('2d'),{kind:'RELATIVE_DAYS',amount:2});
 assert(gileadPublicAgeEvidenceSchema.safeParse({policy:'GILEAD_PUBLIC_AGE_PRESERVATION_V1',rawLabel:'',classification:{kind:'UNKNOWN'},exactDateStatus:'UNKNOWN',timeWindowStatus:'TIME_WINDOW_UNAVAILABLE',capturedAt:'2026-11-03T00:00:00.000Z',artifactLogicalKey:'page',rowLocator:'row',rowSha256:'a'.repeat(64)}).success);
});
