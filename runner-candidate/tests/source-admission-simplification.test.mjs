import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CITY_PENDING,matchesPortableSearchCity as matchesRunnerCity,isCityPendingJob as runnerCityPending} from '../src/domain/jobLocation.ts';
import {matchesPortableSearchCity,isCityPendingJob,NATIONWIDE} from '../../web-candidate/src/domain/jobLocation.ts';
import {bmsMainlandCities} from '../src/crawler/bmsMainlandGeography.ts';
import {biogenListCities} from '../src/crawler/biogenListGeographyGuard.ts';
import {projectAmgenNativeCities,parseWorkdayMainlandRow} from '../src/crawler/workdayMainlandQuality.ts';
import {ucbOfficialCities} from '../src/crawler/ucbOfficialPostedDate.ts';
import {merckOfficialCities} from '../src/crawler/merckChinaQuality.ts';
import {lillyOfficialCities} from '../src/crawler/lillyChinaQuality.ts';
import {organonOfficialCities} from '../src/crawler/organonChinaQuality.ts';
import {phenomMainlandGeography} from '../src/crawler/phenomMainlandGeography.ts';
import {biDisplayCities,hasBiMainlandGeography} from '../src/crawler/biSemanticCompleteness.ts';
import {mokaPublishedAtIso} from '../src/crawler/mokaSourceFetch.ts';
import {parseAstellasLocationPages} from '../src/crawler/astellasPdfLocations.ts';
import {hasExactFosunMainlandGeography,mainlandDisplayCities} from '../src/crawler/fosunScopeGeography.ts';
import {qiluReviewedRowGeography} from '../src/crawler/manualChromeQiluReplay.ts';
import {classifyKelunLocation} from '../src/crawler/kelunMainlandScope.ts';
import {beisenDomesticRecordScopeReview} from '../src/crawler/officialJsonSourceFetch.ts';
import {hasMainlandCountryLocation,mokaDisplayCities} from '../src/crawler/hengruiMainlandGeography.ts';
import {classifyGileadPublicAge,gileadPublicAgeEvidenceSchema,GILEAD_YELLO_BOARD,GILEAD_PUBLIC_AGE_POLICY} from '../src/crawler/gileadPublicAge.ts';
import {parseYelloJobBoardResponse} from '../src/crawler/yelloJobBoardEvidence.ts';
import {PFIZER_CHINA, PFIZER_ENTRY, projectPfizerDetail} from '../src/crawler/pfizerWorkdayTraversal.ts';
const pending=[CITY_PENDING],fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}-location-change.json`,import.meta.url)));

test('BI requires mainland evidence while preserving unrecognized city labels',()=>{
 const kunshan={jobareaname:'昆山',workareaname:'昆山',ejobareaname:'Kunshan',eworkareaname:'Kunshan'};
 for(const address of ['江苏·昆山','中国·昆山']){
  assert(hasBiMainlandGeography({...kunshan,address}));
  assert.deepEqual(biDisplayCities({...kunshan,address}),pending);
 }
 for(const address of [undefined,'昆山','Unknown street','Tokyo','江苏·东京'])assert.equal(hasBiMainlandGeography({...kunshan,address}),false);
 for(const field of ['jobareaname','workareaname','ejobareaname','eworkareaname']){
  for(const foreign of ['Tokyo','中国·东京','江苏·香港'])assert.equal(hasBiMainlandGeography({...kunshan,address:'江苏·昆山',[field]:foreign}),false,field+': '+foreign);
 }
 assert(hasBiMainlandGeography({jobareaname:'青岛',address:'香港中路'}));
});

test('country-qualified new cities survive without inventing a canonical city',()=>{
 assert.deepEqual(bmsMainlandCities({locations:['Puyang - CN'],standardizedLocations:['Puyang, Henan, CN'],workLocationOption:'hybrid',displayBadge:'New'}),pending);
 assert.deepEqual(projectAmgenNativeCities('Role',['China - Puyang'],'China - Puyang'),pending);
 assert.deepEqual(ucbOfficialCities('Newtown, Qinghai, China',undefined),pending);
 assert.equal(ucbOfficialCities('Tokyo, China','Tokyo'),undefined);
 const biogen={title:'Role',locationsText:'Newtown, China',externalPath:'/job/Newtown-China/Role_REQ123-1',bulletFields:['REQ123'],displayBadge:'New'};
 assert.deepEqual(biogenListCities(biogen),pending);
 assert.equal(biogenListCities({...biogen,locationsText:'Tokyo, China'}),undefined);
 const shanghai={...biogen,locationsText:'Shanghai, China',externalPath:'/job/Shanghai-China/Role_REQ123-1'};
 for(const title of ['Role 工作地点：东京','Role Location: Tokyo','Role (Location: Tokyo)','Role （LOCATION：Tokyo）',
  'Role Location: (Tokyo)','Role 工作地点：（东京）','Role (Location: ((Tokyo)))','Role 工作地点：( （ 东京 ） )',
  'Role Location: (Shanghai) / (Tokyo)','Role 工作地点：（Shanghai）/（东京）',
  'Role Location: (Shanghai) and (Tokyo)','Role 工作地点：（上海）或（东京）'])assert.equal(biogenListCities({...shanghai,title}),undefined,title);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role 工作地点：新城区'}),pending);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role (Location: Shanghai)'}),['上海']);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role Location: (Shanghai)'}),['上海']);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role (Location: Shanghai) - Japan market support'}),['上海']);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role Location: Shanghai - Japan market support'}),['上海']);
 for(const title of ['Regional Security Lead, APAC','External Stakeholder Engagement (ESE), Senior Analyst (Korean Speaking)'])assert.deepEqual(biogenListCities({...shanghai,title}),['上海'],title);
 for(const title of ['Senior Medical Representive (Location: Wuhan)','Medical Representative (Location:Urumqi‌)','Senior Medical Science Liaison (Location: Changsha)'])assert.deepEqual(biogenListCities({...shanghai,title}),pending,title);
 assert.deepEqual(biogenListCities({...shanghai,title:'Role 工作地点：（新城区）'}),pending);
 for(const title of ['Role Location: (Shanghai) / (Beijing)','Role 工作地点：（Shanghai）/（新城区）'])assert.deepEqual(biogenListCities({...shanghai,title}),pending,title);
 const csl={title:'Role',externalPath:'/job/APAC-CN-Puyang-CSL-Behring/Role_R-123',locationsText:'APAC, CN, Puyang, CSL Behring',bulletFields:['Temporary','R-123','Sales','China'],timeType:'Part time',displayBadge:'New'};
 assert(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},csl));
 for(const bulletFields of [['China','R-123'],['Sales','China','Part time','R-123','New badge']])assert(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields}));
 for(const bulletFields of [['Sales','R-123'],['China'],['China','R-123','R-456'],['China','R-456'],['China','China','R-123']])assert.equal(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields}),undefined);
 assert.equal(parseWorkdayMainlandRow({source:{id:'source-csl-china-social'}},{...csl,bulletFields:['Temporary','R-123','Sales','Japan']}),undefined);
});

test('Amgen resolves reviewed city labels while preserving location conflicts',()=>{
 for(const [title,label,city] of [
  ['Account Executive','Harbin','哈尔滨'],
  ['Biopharmaceutical Rep-Nanchong','Nanchong','南充'],
  ['Biopharmaceutical Rep-Xinxiang','Xinxiang','新乡'],
  ['Sr Biopharmaceutical Rep-Neijiang','Neijiang','内江']
 ]){
  const location=`China - ${label}`;
  assert.deepEqual(projectAmgenNativeCities(title,[location],location),[city]);
 }
 assert.deepEqual(projectAmgenNativeCities('Biopharmaceutical Rep-Nanchong',['China - Nanchong'],'China - Beijing'),pending);
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

test('explicit nationwide locations remain searchable instead of becoming pending',()=>{
 for(const [locations,expected] of [
  [['全国'],[NATIONWIDE]],[[' 全国各地 '],[NATIONWIDE]],[['中国·全国'],[NATIONWIDE]],
  [['全国 / 上海'],[NATIONWIDE,'上海']],[['上海','全国'],['上海',NATIONWIDE]],
  [['全国','新城区'],[NATIONWIDE]],[['全国','中国'],[NATIONWIDE]],[['新城区'],pending]
 ]){
  const cities=mainlandDisplayCities(locations);assert.deepEqual(cities,expected);
  const job={city:cities[0],cities,locationRaw:locations.join(' / ')},nationwide=expected.includes(NATIONWIDE);
  for(const matches of [matchesRunnerCity,matchesPortableSearchCity])assert.equal(matches(job,NATIONWIDE),nationwide);
  for(const isPending of [runnerCityPending,isCityPendingJob])assert.equal(isPending(job),!nationwide);
 }
 assert(hasExactFosunMainlandGeography({LocNames:['全国'],City:'上海'}));
 assert.equal(hasExactFosunMainlandGeography({LocNames:['全国 / Tokyo']}),false);
});

test('Moka country-only display stays pending independently of optional region IDs',()=>{
 for(const country of ['China','CN','中国','中国大陆','中华人民共和国']){
  const location={country};
  assert(hasMainlandCountryLocation(location));
  assert.deepEqual(mokaDisplayCities([location]),pending);
  for(const field of ['cityId','provinceId'])for(const id of [0,-1,null,'310100',999999,310100])assert.deepEqual(mokaDisplayCities([{...location,[field]:id}]),pending,`${country}/${field}/${id}`);
 }
 for(const country of ['PRC','Mainland China'])assert.deepEqual(mokaDisplayCities([{country,cityId:0}]),pending);
 assert.deepEqual(mokaDisplayCities([{country:'China',cityName:null,provinceName:null,cityId:0}]),pending);
 const shanghai={country:'中国',cityName:'上海'};
 assert.deepEqual(mokaDisplayCities([shanghai]),['上海']);
 assert.deepEqual(mokaDisplayCities([{...shanghai,cityId:0}]),['上海']);
 assert.deepEqual(mokaDisplayCities([shanghai,{country:'China'}]),pending);
 assert.deepEqual(mokaDisplayCities([]),[]);
});

test('Moka foreign location display does not hide a known mainland search city',()=>{
 const shanghai={country:'中国',cityName:'上海'};
 for(const country of ['Japan','日本','United States','Singapore','SG','Hong Kong','香港','Macao','台湾']){
  for(const foreign of [{country},{country,cityName:'Tokyo'},{country,cityName:null,provinceName:null,cityId:0}]){
   for(const locations of [[shanghai,foreign],[foreign,shanghai]]){
    const cities=mokaDisplayCities(locations);
    assert.deepEqual(cities,['上海'],country);
    assert(matchesPortableSearchCity({city:cities[0],cities,locationRaw:`上海、${country}`},'上海'),country);
   }
   assert.deepEqual(mokaDisplayCities([foreign]),[],country);
  }
 }
 assert.deepEqual(mokaDisplayCities([shanghai,{country:'China'},{country:'Japan'}]),pending);
 assert.deepEqual(mokaDisplayCities([shanghai,{country:'Unknown country'}]),pending);
});

test('unrecognized display age stays unknown instead of rejecting the job',()=>{
 assert.equal(mokaPublishedAtIso('2026-11-03 25:61:00'),undefined);
 assert.deepEqual(classifyGileadPublicAge('Recently posted'),{kind:'UNKNOWN'});
 assert.deepEqual(classifyGileadPublicAge(''),{kind:'UNKNOWN'});
 assert.deepEqual(classifyGileadPublicAge('2d'),{kind:'RELATIVE_DAYS',amount:2});
 assert(gileadPublicAgeEvidenceSchema.safeParse({policy:'GILEAD_PUBLIC_AGE_PRESERVATION_V1',rawLabel:'',classification:{kind:'UNKNOWN'},exactDateStatus:'UNKNOWN',timeWindowStatus:'TIME_WINDOW_UNAVAILABLE',capturedAt:'2026-11-03T00:00:00.000Z',artifactLogicalKey:'page',rowLocator:'row',rowSha256:'a'.repeat(64)}).success);
});

test('Gilead Hong Kong exclusion holds additional location evidence without restricting age or badges',()=>{
 const config={kind:'yello-job-board',boardId:GILEAD_YELLO_BOARD,locationFilterId:72,expectedLocationLabel:'China',publicAgePolicy:GILEAD_PUBLIC_AGE_POLICY};
 const body=(extra,rowAttributes='')=>JSON.stringify({html:`<li class="search-results__item" ${rowAttributes}><div class="clearfix"><div class="search-results__flag"><img alt="Hong Kong flag" src="/assets/images/flags/hk.png"></div><div class="search-results__jobinfo"><a class="search-results__req_title" href="/jobs/${'S'.repeat(22)}?job_board_id=${GILEAD_YELLO_BOARD}">Synthetic Shanghai regional role</a><div><span>China - Hong Kong</span><span>China - Shanghai regional support</span><span>Regular</span></div></div><div class="search-results__post-time"><span>Recently posted</span></div>${extra}</div></li>`,
  count_on_page:1,more_requisitions:false,query:'',filters:JSON.stringify([{label:'Locations',id:32,has_conditions:false,answers:[{id:72,label:'China'}],answer_type:'multiple_select'}]),text_filters:'[]',display_count_text:'1 Result'});
 for(const extra of ['', '<span class="badge">New</span>'])assert.equal(parseYelloJobBoardResponse(body(extra),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('').replace('search-results__req_title','search-results__req_title country-manager'),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('').replace('search-results__item','search-results__item country-manager'),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('', 'role="country-manager"'),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('<span class="country-manager">New</span>'),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('', 'data-id="synthetic"'),config).excludedJobs.length,1);
 assert.equal(parseYelloJobBoardResponse(body('', 'data-location="China - Shanghai"'),config).quarantinedJobs.length,1);
 for(const extra of ['<div class="alternate-location">China - Shanghai</div>','<div>China - Shanghai</div>','<div class="alternate-location">Unknown country</div>','<span data-location="Unknown"></span>',
  ...['alternate-location-details','location-details','details-location','alternate_location_details','ALTERNATE-LOCATION-DETAILS'].map(name=>`<div class="${name}">Shanghai</div>`)]){
  assert.equal(parseYelloJobBoardResponse(body(extra),config).quarantinedJobs.length,1,extra);
 }
});


test('Pfizer keeps the reviewed Beijing office as an alternate city', () => {
 const id='4966466',path='/job/China---Shanghai---STIT/Clinical-Assay-Lead_'+id;
 const title='Clinical Assay Lead, Manager (Contractor) - Shanghai or Beijing';
 const row={title,bulletFields:[id],externalPath:path};
 const info={jobReqId:id,title,jobPostingSiteId:'PfizerCareers',externalUrl:PFIZER_ENTRY+path,
  posted:true,canApply:true,jobDescription:'<p>Role description</p>',location:'China - Shanghai - STIT',
  additionalLocations:['CHN - BJ - Beijing R&D Center'],
  country:{descriptor:'China',id:PFIZER_CHINA},jobRequisitionLocation:{country:{descriptor:'China',alpha2Code:'CN'}}};
 assert.deepEqual(projectPfizerDetail(row,JSON.stringify({jobPostingInfo:info})).job.cities,['上海','北京']);
});
