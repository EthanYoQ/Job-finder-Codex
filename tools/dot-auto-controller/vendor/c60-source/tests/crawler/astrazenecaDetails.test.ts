// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { azDetail, azListCapture, azResponse, azRow, AZ_NOW } from '../helpers/astrazeneca';
import { parseAstraZenecaDetail, astraZenecaPostedDay, fetchAstraZenecaDetail } from '../../src/crawler/astraZenecaDetails';
import { acquireAstraZenecaDetails, replayAstraZenecaDetails, replayAstraZenecaList } from '../../src/crawler/astraZenecaDetailAcquisition';
import { ASTRAZENECA_DETAIL_CONFIG } from '../../src/crawler/astraZenecaDetailContract';
import { sha256Bytes } from '../../src/crawler/sourceFetchEvidence';
import { validateStrictHtmlCompletenessProof } from '../../src/crawler/strictHtmlCompletenessProof';
import { runSourceCrawl, replayStrictSourceQualityEvidenceAsync } from '../../src/crawler/runSourceCrawl';
import { matchesPortableSearchCity } from '../../src/domain/jobLocation';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('AstraZeneca calendar-day evidence',()=>{
  it('preserves official day precision without inventing an observed instant',()=>{
    expect(astraZenecaPostedDay('2026-9-1','发布日期 09/01/2026')).toEqual({raw:'2026-9-1',calendarDay:'2026-09-01',precision:'DAY',canonicalSortEncoding:'2026-09-01T00:00:00.000Z'});
  });
  it.each(['2026-2-29','2026-13-1','2026-9-31','2026-09-01T00:00:00Z','2026-9-1 junk'])('rejects non-calendar date %s',raw=>expect(()=>astraZenecaPostedDay(raw,'发布日期 09/01/2026')).toThrow());
  it('rejects conflicting visible dates',()=>expect(()=>astraZenecaPostedDay('2026-9-1','发布日期 09/02/2026')).toThrow());
});
describe('AstraZeneca strict JobPosting evidence',()=>{
  it('requires identity, URL, DOM and schema agreement and returns raw fields',()=>{
    const row=azRow(),body=azDetail(row);const result=parseAstraZenecaDetail(body,row);
    expect(result).toMatchObject({sourceJobId:row.sourceJobId,requisitionId:'TP24605',officialTitle:row.officialTitle,cities:['无锡'],locationStatus:'CITY_SPECIFIC',postedDay:{precision:'DAY',calendarDay:'2026-09-01'},bodySha256:sha256Bytes(Buffer.from(body)).sha256});
    expect(result.locations[0]).toEqual({visibleRaw:'无锡市, 江苏, 中国',schemaRaw:{city:'Wuxi',region:'Jiangsu',country:'CN'},city:'无锡'});
  });
  it('accepts the official description serializer whitespace and quote variants',()=>{
    const row=azRow();
    const body=azDetail(row).replace('<p>Official job description</p>', "<p>Work <b>with</b> 'business questions'</p>")
      .replace('>Official job description</div>', '>Work<b>with</b> &quot;business questions&quot;</div>');
    expect(parseAstraZenecaDetail(body,row).sourceJobId).toBe(row.sourceJobId);
    expect(()=>parseAstraZenecaDetail(body.replace('>Work<b>with</b>', '>Work<b>without</b>'),row)).toThrow('DETAIL_IDENTITY_INVALID');
  });
  it('keeps conflicting calendar days unknown without inventing a date',()=>{
    const parsed=parseAstraZenecaDetail(azDetail(azRow(),{date:'2026-9-2'}),azRow());
    expect(parsed.postedDay).toBeUndefined();
    expect(parsed.dateConflict).toEqual({status:'UNKNOWN',schemaRaw:'2026-9-2',visibleRaw:'发布日期 09/01/2026'});
    expect(()=>parseAstraZenecaDetail(azDetail(azRow(),{date:'2026-2-30'}),azRow())).toThrow('DETAIL_DATE_INVALID');
  });
  it('keeps a China-positive DOM/schema city conflict pending with both originals',()=>{
    const row=azRow(undefined,'MR-GI-西安','陕西 咸阳市');
    const parsed=parseAstraZenecaDetail(azDetail(row,{city:'Xian',region:'Shanxi',visibleCity:'咸阳市',visibleRegion:'陕西'}),row);
    expect(parsed.cities).toEqual(['城市待核']);
    expect(parsed.locations[0]).toMatchObject({visibleRaw:'咸阳市, 陕西, 中国',schemaRaw:{city:'Xian',region:'Shanxi',country:'CN'},conflict:true});
  });
  it('requires a bound active native application for missing country-only schema',()=>{
    const row=azRow(undefined,'Nationwide role','中国');
    const initial=azDetail(row,{city:'',region:''}).replace('<span>无锡市, </span><span>江苏, </span><span>中国</span>','<span>中国</span>');
    const body=initial.replace(/,"jobLocation":\[[\s\S]*?\]\}/u,'}');
    const applicationBody='<input id="positionId" value="test"><input id="positionName" value="Nationwide role"><input id="positionStatus" value="PUBLISHING"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-header"><h4 class="name">Nationwide role</h4></div><ul class="position-extend"><li class="city">全国</li></ul><div class="position-description">Official job description</div>';
    const artifact={id:`astrazeneca-application-${row.sourceJobId}`,logicalKey:`astrazeneca-application-${row.sourceJobId}`,kind:'ATS_PAGE' as const,requestedUrl:'https://careersite.tupu360.com/astrazeneca/position/detail?positionId=test',finalUrl:'https://careersite.tupu360.com/astrazeneca/position/detail?positionId=test',httpStatus:200,contentType:'text/html',capturedAt:AZ_NOW,body:Buffer.from(applicationBody),bodyRepresentation:'EXACT' as const,extractorLocator:ASTRAZENECA_DETAIL_CONFIG.extractor};
    expect(()=>parseAstraZenecaDetail(body,row)).toThrow('DETAIL_APPLICATION_REQUIRED');
    expect(parseAstraZenecaDetail(body,row,artifact)).toMatchObject({cities:['城市待核'],locations:[{visibleRaw:'中国'}],application:{positionId:'test',locationRaw:'全国'}});
    for(const changed of [applicationBody.replace('PUBLISHING','CLOSED'),applicationBody.replace('value="test"','value="other"'),applicationBody.replace('>Official job description<','>Different description<')])expect(()=>parseAstraZenecaDetail(body,row,{...artifact,body:Buffer.from(changed)})).toThrow('DETAIL_APPLICATION_INVALID');
    expect(()=>parseAstraZenecaDetail(azDetail(azRow()).replace('careersite.tupu360.com','example.org'),azRow())).toThrow('DETAIL_APPLICATION_INVALID');
  });
  it.each([
    ['wrong native ID',(s:string)=>s.replaceAll('data-job-id="100033677408"','data-job-id="999"')],
    ['wrong title',(s:string)=>s.replace('<h1>Senior Director</h1>','<h1>Other</h1>')],
    ['wrong requisition',(s:string)=>s.replace('content="TP24605"','content="TP999"')],
    ['wrong URL',(s:string)=>s.replace('"url":"https://','"url":"https://evil.')],
    ['extra JobPosting',(s:string)=>s.replace('</head>',`${s.match(/<script[\s\S]*?<\/script>/u)![0]}</head>`)],
    ['invalid JSON',(s:string)=>s.replace('"@type":"JobPosting"','"@type":JobPosting')],
    ['duplicate JSON keys',(s:string)=>s.replace('"title":"Senior Director"','"title":"Other","title":"Senior Director"')],
    ['missing location',(s:string)=>s.replace('class="job-locations"','class="removed"')],
    ['hidden job',(s:string)=>s.replace('class="job-description"','class="job-description" hidden')],
    ['hidden H1 text',(s:string)=>s.replace('<h1>Senior Director</h1>','<h1><span hidden>Senior Director</span></h1>')],
    ['hidden location text',(s:string)=>s.replace('<span>无锡市, </span>','<span hidden>无锡市, </span>')],
    ['hidden date text',(s:string)=>s.replace('发布日期</b> 09/01/2026','发布日期</b><span hidden> 09/01/2026</span>')],
    ['foreign country',(s:string)=>s.replace('"addressCountry":"CN"','"addressCountry":"US"')],
    ['unknown country',(s:string)=>s.replace('"addressCountry":"CN"','"addressCountry":"??"')],
    ['closed common description',(s:string)=>s.replace('<div class="ats-description">Official job description</div>','<div class="ats-description">This job is closed</div>')],
    ['unreviewed description suffix',(s:string)=>s.replace('<div class="ats-description">Official job description</div>','<div class="ats-description">Official job description This job is closed</div>')],
  ])('rejects %s',(_label,mutate)=>expect(()=>parseAstraZenecaDetail(mutate(azDetail(azRow())),azRow())).toThrow());
  it('keeps China-positive unfamiliar cities pending, never taking a city from the title',()=>{
    const row=azRow(undefined,'Specialist Beijing');
    const result=parseAstraZenecaDetail(azDetail(row,{city:'新城市',visibleCity:'新城市'}),row);
    expect(result.cities).toEqual(['城市待核']);expect(result.postedDay?.precision).toBe('DAY');
  });
  it('does not resolve a list/title conflict merely because detail repeats the list location',()=>{
    const row=azRow(undefined,'MR-BC-北京','上海 上海');
    expect(parseAstraZenecaDetail(azDetail(row,{city:'Shanghai',region:'Shanghai',visibleCity:'上海',visibleRegion:'上海'}),row).cities).toEqual(['城市待核']);
  });
  it('never overwrites an unfamiliar explicit list city with a different detail city',()=>{
    const row=azRow(undefined,'Role','江苏 常州市');expect(parseAstraZenecaDetail(azDetail(row),row).cities).toEqual(['城市待核']);
  });
  it('rejects an explicitly foreign city even when country says CN',()=>{
    const row=azRow();expect(()=>parseAstraZenecaDetail(azDetail(row,{city:'Tokyo',visibleCity:'Tokyo'}),row)).toThrow('DETAIL_COUNTRY_INVALID');
  });
  it('keeps country-only geography pending and outside every exact supported city',()=>{
    const row=azRow(undefined,'Role','中国');let body=azDetail(row,{city:'',region:''});
    body=body.replace('<span>无锡市, </span><span>江苏, </span><span>中国</span>','<span>中国</span>');
    const parsed=parseAstraZenecaDetail(body,row);expect(parsed.cities).toEqual(['城市待核']);
    for(const city of ['北京','上海','广州'])expect(matchesPortableSearchCity({city:parsed.cities[0]!,cities:parsed.cities},city)).toBe(false);
  });
});
describe('AstraZeneca owned enrichment and replay',()=>{
  it('uses explicit enrichment in the crawl result and fails closed when a claim is changed',async()=>{
    const row=azRow(),c=await azListCapture([row]);vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(row)));
    const result=await runSourceCrawl(c.plan,{fetch:async()=>acquireAstraZenecaDetails(c.plan,c.fetched),isBaseline:false});
    expect(result.jobs[0]!.cities).toEqual(['无锡']);expect(result.truth.completenessVerified).toBe(true);
    const changed=structuredClone(result.jobs);changed[0]!.evidence.astraZenecaDetail!.postedDay!.precision='DAY';changed[0]!.evidence.astraZenecaDetail!.postedDay!.calendarDay='2020-01-01';
    expect(await replayStrictSourceQualityEvidenceAsync({plan:c.plan,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:changed,capturedAt:AZ_NOW})).toBe(false);
  });
  it('retains explicit internship type evidence and rows while holding scope review',async()=>{
    const row=azRow(undefined,'Graduate programme'),c=await azListCapture([row]);
    vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(row).replace('"datePosted":','"employmentType":"INTERN","datePosted":')));
    const acquired=await acquireAstraZenecaDetails(c.plan,c.fetched),replay=replayAstraZenecaDetails(c.plan,acquired.fetchEvidence!,AZ_NOW,true);
    expect(replay.jobs).toHaveLength(1);expect(replay.scopeReviewRequired).toBe(true);
    expect(replay.jobs[0]!.evidence.astraZenecaDetail).toMatchObject({employmentTypeRaw:'INTERN',scopeReviewCodes:['TITLE_EARLY_CAREER','EMPLOYMENT_INTERNSHIP']});
    const result=await runSourceCrawl(c.plan,{fetch:async()=>acquired});expect(result.truth.completenessVerified).toBe(false);
  });
  it('preserves all list rows, archives exact bodies and independently replays dates and cities',async()=>{
    const rows=[azRow(),azRow('101318921472','Global Study Lead','江苏 无锡市')];const c=await azListCapture(rows);
    vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(rows.find(r=>r.officialUrl===url)!)));
    const acquired=await acquireAstraZenecaDetails(c.plan,c.fetched);
    const replay=replayAstraZenecaDetails(c.plan,acquired.fetchEvidence!,AZ_NOW,false);
    expect(replay.jobs.map(j=>j.sourceJobId)).toEqual(rows.map(r=>r.sourceJobId));expect(replay.detailComplete).toBe(true);
    expect(replay.jobs[0]).toMatchObject({locationRaw:'Multiple locations',cities:['无锡'],evidence:{astraZenecaDetail:{postedDay:{precision:'DAY'}}}});
    expect(replay.jobs.every(j=>j.officialPublishedAt===undefined)).toBe(true);
    expect(replay.listEvidence.artifacts).toHaveLength(1);expect(acquired.fetchEvidence!.artifacts).toHaveLength(3);
    expect(c.plan.adapterId==='html-table'&&validateStrictHtmlCompletenessProof(c.plan,acquired.fetchEvidence!)).toBe(false);
  });
  it('does not silently fall back when a detail is unavailable',async()=>{
    const rows=[azRow()];const c=await azListCapture(rows);vi.stubGlobal('fetch',async(url:string)=>azResponse(url,'not found',404));
    const result=await acquireAstraZenecaDetails(c.plan,c.fetched);const replay=replayAstraZenecaDetails(c.plan,result.fetchEvidence!,AZ_NOW,true);
    expect(replay.detailComplete).toBe(false);expect(replay.jobs).toHaveLength(1);expect(replay.jobs[0]!.cities).toEqual(['城市待核']);
    expect(replay.jobs[0]!.evidence.astraZenecaDetail?.status).toBe('UNRESOLVED');
  });
  it('holds contradictory detail countries without asserting that row is China-proven',async()=>{
    const row=azRow(),c=await azListCapture([row]);vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(row,{country:'US',visibleCountry:'美国'})));
    const acquired=await acquireAstraZenecaDetails(c.plan,c.fetched),replay=replayAstraZenecaDetails(c.plan,acquired.fetchEvidence!,AZ_NOW,true);
    expect(replay.jobs).toHaveLength(1);expect(replay.detailComplete).toBe(false);expect(replay.scopeReviewRequired).toBe(true);
    expect(replay.jobs[0]!.evidence.astraZenecaDetail?.country).toBeUndefined();expect(replay.jobs[0]!.evidence.astraZenecaDetail).toMatchObject({sourceCountryContext:'中国',failureCode:'DETAIL_COUNTRY_INVALID'});
  });
  it('validates native country-facet count and page coordinates independently',async()=>{
    const c=await azListCapture(Array.from({length:17},(_,i)=>azRow(String(i+100),'Role '+i,'上海 上海')));
    expect(replayAstraZenecaList(c.plan,c.fetched.fetchEvidence!,AZ_NOW,true)).toHaveLength(17);
    for(const [from,to] of [['data-count="17"','data-count="16"'],['data-id="1814991"','data-id="999"'],['data-current-page="1"','data-current-page="2"'],['data-display="中国"','data-display="美国"']] as const){
      const evidence=structuredClone(c.fetched.fetchEvidence!);evidence.artifacts[0]!.body=(evidence.artifacts[0]!.body as string).replace(from,to);
      evidence.pages[0]!.responseFingerprintSha256=sha256Bytes(Buffer.from(evidence.artifacts[0]!.body as string)).sha256;
      expect(()=>replayAstraZenecaList(c.plan,evidence,AZ_NOW,true)).toThrow();
    }
  });
  it('rejects duplicate native list IDs even when the generic raw rows remain distinct',async()=>{
    const rows=[azRow(),{...azRow(),officialTitle:'Different raw title'}],c=await azListCapture(rows);
    expect(()=>replayAstraZenecaList(c.plan,c.fetched.fetchEvidence!,AZ_NOW,true)).toThrow();
  });
  it('rejects additional country facets and contradictory raw row countries',async()=>{
    for(const append of ['<input data-facet-type="2" data-id="6252001" data-display="美国" data-count="1">']){
      const c=await azListCapture([azRow()]),e=structuredClone(c.fetched.fetchEvidence!);e.artifacts[0]!.body=(e.artifacts[0]!.body as string)+append;e.pages[0]!.responseFingerprintSha256=sha256Bytes(Buffer.from(e.artifacts[0]!.body as string)).sha256;
      expect(()=>replayAstraZenecaList(c.plan,e,AZ_NOW,true)).toThrow();
    }
    const c=await azListCapture([azRow(undefined,'Role','Canada Toronto')]);expect(()=>replayAstraZenecaList(c.plan,c.fetched.fetchEvidence!,AZ_NOW,true)).toThrow();
  });
  it('rejects omitted, duplicate, forged and redirected detail evidence',async()=>{
    const rows=[azRow(),azRow('101318921472','Global Study Lead')],c=await azListCapture(rows);vi.stubGlobal('fetch',async(url:string)=>azResponse(url,azDetail(rows.find(r=>r.officialUrl===url)!)));
    const result=await acquireAstraZenecaDetails(c.plan,c.fetched);
    const mutations=[(e:any)=>e.astraZenecaDetails.entries.pop(),(e:any)=>e.astraZenecaDetails.entries[1]=e.astraZenecaDetails.entries[0],(e:any)=>e.astraZenecaDetails.entries[0].outcome.evidence.cities=['北京'],(e:any)=>e.artifacts[1].finalUrl=rows[1]!.officialUrl,(e:any)=>e.artifacts.pop()];
    for(const mutate of mutations){const evidence=structuredClone(result.fetchEvidence!);mutate(evidence);expect(()=>replayAstraZenecaDetails(c.plan,evidence,AZ_NOW,true)).toThrow();}
  });
  it('caps simultaneous detail requests at two and stops after a bot block',async()=>{
    const rows=Array.from({length:5},(_,i)=>azRow(String(i+100))),c=await azListCapture(rows);let active=0,max=0;const requested:string[]=[];
    vi.stubGlobal('fetch',async(url:string)=>{requested.push(url);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return azResponse(url,requested.length<=2?'<html><title>Access Denied</title>captcha</html>':azDetail(rows.find(r=>r.officialUrl===url)!));});
    const result=await acquireAstraZenecaDetails(c.plan,c.fetched);expect(max).toBeLessThanOrEqual(2);expect(requested.length).toBeLessThanOrEqual(2);expect(result.fetchEvidence!.astraZenecaDetails!.entries).toHaveLength(5);
    expect(replayAstraZenecaDetails(c.plan,result.fetchEvidence!,AZ_NOW,true).detailComplete).toBe(false);
  });
  it('retains one explicit outcome per row when the total body budget is exhausted',async()=>{
    const rows=Array.from({length:110},(_,i)=>azRow(String(200+i))),c=await azListCapture(rows);let requests=0;
    vi.stubGlobal('fetch',async(url:string)=>{requests++;const row=rows.find(r=>r.officialUrl===url)!;return azResponse(url,azDetail(row,{padding:ASTRAZENECA_DETAIL_CONFIG.maxBodyBytes-2000}));});
    const result=await acquireAstraZenecaDetails(c.plan,c.fetched),entries=result.fetchEvidence!.astraZenecaDetails!.entries;
    expect(entries).toHaveLength(110);expect(requests).toBeLessThan(110);expect(entries.some(e=>!e.outcome.ok&&e.outcome.code==='DETAIL_RETAINED_BUDGET_EXCEEDED')).toBe(true);
    expect(replayAstraZenecaDetails(c.plan,result.fetchEvidence!,AZ_NOW,true).jobs).toHaveLength(110);
  });
});
describe('AstraZeneca bounded transport',()=>{
  it.each([403,429])('stops further requests for HTTP %s even without a usable body',async(status)=>{
    const rows=Array.from({length:5},(_,i)=>azRow(String(500+i))),c=await azListCapture(rows);let requests=0;
    vi.stubGlobal('fetch',async(url:string)=>{requests++;const response=new Response(null,{status});Object.defineProperty(response,'url',{value:url});return response;});
    const result=await acquireAstraZenecaDetails(c.plan,c.fetched);expect(requests).toBeLessThanOrEqual(2);
    expect(result.fetchEvidence!.astraZenecaDetails!.entries.some(e=>!e.outcome.ok&&e.outcome.code==='DETAIL_BOT_BLOCKED')).toBe(true);
    expect(replayAstraZenecaDetails(c.plan,result.fetchEvidence!,AZ_NOW,true).detailComplete).toBe(false);
  });
  it.each(['invalid-utf8','oversized'])('keeps HTTP denial classification for %s denial bodies',async(kind)=>{
    const row=azRow();const response=new Response(kind==='invalid-utf8'?new Uint8Array([255]):'large',{status:403,headers:{'content-type':'text/html',...(kind==='oversized'?{'content-length':String(ASTRAZENECA_DETAIL_CONFIG.maxBodyBytes+1)}:{})}});Object.defineProperty(response,'url',{value:row.officialUrl});
    expect(await fetchAstraZenecaDetail(row,{fetchImpl:async()=>response})).toMatchObject({ok:false,code:'DETAIL_BOT_BLOCKED'});
  });
  it('rejects redirects and oversized streamed bodies',async()=>{
    const row=azRow();
    expect((await fetchAstraZenecaDetail(row,{fetchImpl:async()=>azResponse(row.officialUrl+'/redirect',azDetail(row))})).ok).toBe(false);
    expect(await fetchAstraZenecaDetail(row,{fetchImpl:async()=>azResponse(row.officialUrl,'x'.repeat(ASTRAZENECA_DETAIL_CONFIG.maxBodyBytes+1))})).toMatchObject({ok:false,code:'DETAIL_BODY_TOO_LARGE'});
  });
  it('keeps cancellation active while consuming a slow body',async()=>{
    const row=azRow(),controller=new AbortController();let cancelled=false;
    const pending=fetchAstraZenecaDetail(row,{signal:controller.signal,fetchImpl:async()=>{const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/html'}});Object.defineProperty(response,'url',{value:row.officialUrl});return response;}});
    await new Promise(r=>setTimeout(r,2));controller.abort();expect(await pending).toMatchObject({ok:false,code:'DETAIL_CANCELLED'});expect(cancelled).toBe(true);
  });
  it('does not start a request after cancellation',async()=>{
    const controller=new AbortController();controller.abort();let called=false;
    expect(await fetchAstraZenecaDetail(azRow(),{signal:controller.signal,fetchImpl:async()=>{called=true;throw Error('should not run');}})).toMatchObject({ok:false,code:'DETAIL_CANCELLED'});expect(called).toBe(false);
  });
});
