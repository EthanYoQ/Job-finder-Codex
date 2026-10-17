// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { azDetail, azListCapture, azResponse, azRow, AZ_NOW } from '../helpers/astrazeneca';
import { parseAstraZenecaDetail } from '../../src/crawler/astraZenecaDetails';
import { acquireAstraZenecaDetails, replayAstraZenecaDetails } from '../../src/crawler/astraZenecaDetailAcquisition';
import { runSourceCrawl, replayStrictSourceQualityEvidenceAsync } from '../../src/crawler/runSourceCrawl';
import { sha256Bytes } from '../../src/crawler/sourceFetchEvidence';
const objectId=(body:string)=>body.replace('"identifier":"TP24605"','"identifier":{"@type":"PropertyValue","name":"Job ID","value":"TP24605"}');
const withDescription=(body:string,serialized:string,visible:string)=>body.replace('<p>Official job description</p>',serialized).replace('>Official job description</div>','>'+visible+'</div>');
const claimWithoutHash=(body:string)=>{const {bodySha256,...claim}=parseAstraZenecaDetail(body,azRow());return claim;};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('AZ minimal native format compatibility',()=>{
 it('accepts exact PropertyValue without changing native TP identity or other claim fields',()=>{
  const plain=azDetail(azRow()),object=objectId(plain);expect(claimWithoutHash(object)).toEqual(claimWithoutHash(plain));
  expect(parseAstraZenecaDetail(object,azRow()).bodySha256).toBe(sha256Bytes(Buffer.from(object)).sha256);
 });
 it.each([
  ['name', (s:string)=>s.replace('"name":"Job ID"','"name":"Other"')],
  ['type', (s:string)=>s.replace('"@type":"PropertyValue"','"@type":"Thing"')],
  ['wrong TP', (s:string)=>s.replace('"value":"TP24605"','"value":"TP999"')],
  ['R ID', (s:string)=>s.replace('"value":"TP24605"','"value":"R24605"')],
  ['numeric', (s:string)=>s.replace('"value":"TP24605"','"value":24605')],
  ['extra key', (s:string)=>s.replace('"value":"TP24605"','"value":"TP24605","extra":true')],
  ['duplicate key', (s:string)=>s.replace('"value":"TP24605"','"value":"TP24605","value":"TP24605"')],
 ])('rejects changed PropertyValue %s',(_label,mutate)=>expect(()=>parseAstraZenecaDetail(mutate(objectId(azDetail(azRow()))),azRow())).toThrow());
 it('preserves literal TAB semantics and the exact raw-body hash',()=>{
  const base=objectId(azDetail(azRow()));
  const literal=withDescription(base,'<p>Official\tjob description</p>','Official\tjob description');
  const escaped=withDescription(base,'<p>Official\\tjob description</p>','Official\tjob description');
  expect(claimWithoutHash(literal)).toEqual(claimWithoutHash(escaped));
  expect(parseAstraZenecaDetail(literal,azRow()).bodySha256).toBe(sha256Bytes(Buffer.from(literal)).sha256);
  expect(literal).toContain('Official\tjob description');
 });
 it.each([
  ['newline','\n'],['carriage return','\r'],['NUL','\x00'],['backslash TAB',String.fromCharCode(92,9)],['invalid escape',String.raw`\q`],
 ])('keeps malformed JSON %s rejected',(_label,control)=>{
  const body=withDescription(objectId(azDetail(azRow())),'<p>Official'+control+'job description</p>','Official job description');
  expect(()=>parseAstraZenecaDetail(body,azRow())).toThrow();
 });
 it('does not repair trailing commas even when a literal TAB is present',()=>{
  const body=withDescription(objectId(azDetail(azRow())),'<p>Official\tjob description</p>','Official job description').replace('"name":"Job ID"','"name":"Job ID",');
  expect(()=>parseAstraZenecaDetail(body,azRow())).toThrow('DETAIL_PARSE_INVALID');
 });
 it('uses the exact reviewed Hefei/Anhui bilingual pair with CN and DOM agreement',()=>{
  const row=azRow(undefined,'MR-GI-合肥','安徽 合肥');
  expect(parseAstraZenecaDetail(objectId(azDetail(row,{city:'Hefei',region:'Anhui',visibleCity:'合肥',visibleRegion:'安徽'})),row).cities).toEqual(['合肥']);
 });
 it('retains a wrong-province city as pending instead of correcting it',()=>{
  const row=azRow(undefined,'MR-GI-合肥','安徽 合肥');
  expect(parseAstraZenecaDetail(objectId(azDetail(row,{city:'Hefei',region:'Jiangsu',visibleCity:'合肥',visibleRegion:'江苏'})),row).cities).toEqual(['城市待核']);
 });
 it.each(['US','HK','??'])('still rejects foreign/unknown country %s',country=>{
  const row=azRow();expect(()=>parseAstraZenecaDetail(objectId(azDetail(row,{city:'Hefei',region:'Anhui',country,visibleCity:'合肥',visibleRegion:'安徽'})),row)).toThrow('DETAIL_COUNTRY_INVALID');
 });
 it('still rejects a non-mainland city with CN',()=>{
  const row=azRow();expect(()=>parseAstraZenecaDetail(objectId(azDetail(row,{city:'Hong Kong',region:'Anhui',visibleCity:'香港',visibleRegion:'安徽'})),row)).toThrow('DETAIL_COUNTRY_INVALID');
 });
});
describe('AZ original owned full fixture',()=>{
 it('captures all 17 rows on two list pages and follows the original native application branch',async()=>{
  const rows=Array.from({length:17},(_,i)=>azRow(String(100000000000+i),'Role '+i,'江苏 无锡市'));
  rows[0]=azRow(rows[0]!.sourceJobId,'Nationwide role','中国');
  rows[1]=azRow(rows[1]!.sourceJobId,'MR-GI-合肥','安徽 合肥');
  const c=await azListCapture(rows),requests:string[]=[];
  const application='<input id="positionId" value="test"><input id="positionName" value="Nationwide role"><input id="positionStatus" value="PUBLISHING"><input id="recruitmentType" value="SOCIALRECRUITMENT"><div class="position-header"><h4 class="name">Nationwide role</h4></div><ul class="position-extend"><li class="city">全国</li></ul><div class="position-description">Official job description</div>';
  vi.stubGlobal('fetch',async(url:string)=>{
   requests.push(url);if(url.startsWith('https://careersite.tupu360.com/'))return azResponse(url,application);
   const row=rows.find(r=>r.officialUrl===url)!;expect(row).toBeDefined();let body=objectId(azDetail(row));
   if(row===rows[0])body=body.replace(/,"jobLocation":\[[\s\S]*?\]\}/u,'}').replace('<span>无锡市, </span><span>江苏, </span><span>中国</span>','<span>中国</span>');
   if(row===rows[1])body=objectId(azDetail(row,{city:'Hefei',region:'Anhui',visibleCity:'合肥',visibleRegion:'安徽'}));
   if(row===rows[2])body=withDescription(body,'<p>Official\tjob description</p>','Official\tjob description');
   return azResponse(url,body);
  });
  const acquired=await acquireAstraZenecaDetails(c.plan,c.fetched),replay=replayAstraZenecaDetails(c.plan,acquired.fetchEvidence!,AZ_NOW,false);
  expect(requests).toHaveLength(18);expect(requests.filter(u=>u.startsWith('https://careersite.tupu360.com/'))).toHaveLength(1);
  expect(replay.detailComplete).toBe(true);expect(replay.jobs.map(j=>j.sourceJobId)).toEqual(rows.map(r=>r.sourceJobId));
  expect(acquired.fetchEvidence!.artifacts).toHaveLength(20);expect(replay.listEvidence.artifacts).toHaveLength(2);
  expect(replay.jobs[0]!.cities).toEqual(['城市待核']);expect(replay.jobs[1]!.cities).toEqual(['合肥']);
  const result=await runSourceCrawl(c.plan,{fetch:async()=>acquired,isBaseline:false});expect(result.truth.completenessVerified).toBe(true);
  expect(await replayStrictSourceQualityEvidenceAsync({plan:c.plan,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,capturedAt:AZ_NOW})).toBe(true);
  const withoutApply=structuredClone(acquired.fetchEvidence!);withoutApply.artifacts=withoutApply.artifacts.filter(a=>!a.logicalKey.startsWith('astrazeneca-application-'));
  expect(()=>replayAstraZenecaDetails(c.plan,withoutApply,AZ_NOW,true)).toThrow();
 });
});
