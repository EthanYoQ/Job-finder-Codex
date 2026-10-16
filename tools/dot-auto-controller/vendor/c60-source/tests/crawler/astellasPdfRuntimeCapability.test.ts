// @vitest-environment node
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
const control=vi.hoisted(()=>({mode:''}));
vi.mock('node:child_process',async original=>{
 const real=await original<typeof import('node:child_process')>();
 return {...real,execFile:(...args:any[])=>{
  const command=String(args[0]),argv=args[1] as string[],callback=args[3];
  const version=argv.includes('-v'),info=argv.includes('/usr/bin/pdfinfo'),text=argv.includes('/usr/bin/pdftotext');
  const missing=control.mode==='missing-prlimit'||control.mode==='missing-pdfinfo'&&info||control.mode==='missing-pdftotext'&&text;
  const badDocument=control.mode==='unreadable-document'&&!version;
  if(command==='/usr/bin/prlimit'&&(missing||badDocument||control.mode==='mismatched-version'&&version&&text)){
   const child={stdin:new PassThrough()};queueMicrotask(()=>callback(missing||badDocument?Error('ENOENT or unreadable'):null,'',control.mode==='mismatched-version'?'pdftotext version 0.0.0\n':''));return child;
  }
  return (real.execFile as any)(...args);
 }};
});
import { candidateCompanies } from '../../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans } from '../../src/crawler/sourcePlan';
import { createOwnedSourceQualityFetch } from '../../src/crawler/sourceQualityAdmission';
import { runSourceCrawl } from '../../src/crawler/runSourceCrawl';
import { syntheticPdf } from '../helpers/astellasPdf';
afterEach(()=>{control.mode='';vi.unstubAllGlobals();});
async function capture(){
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-astellas-china-social')!;
 const url='https://www.astellas.com/content/dam/astellas-com/global/zh/test.pdf';const requests:string[]=[];
 vi.stubGlobal('fetch',async(input:string)=>{requests.push(String(input));const isList=String(input)===plan.source.officialEntryUrl;if(!isList&&String(input)!==url)throw Error('UNEXPECTED_URL');
  const res=new Response(isList?`<div class="cmp-accordion" data-cmp-is="accordion"><a href="${url}"><span>Test role</span></a></div>`:syntheticPdf(['Location: Beijing']),{status:200,headers:{'content-type':isList?'text/html':'application/pdf'}});Object.defineProperty(res,'url',{value:String(input)});return res;});
 const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch()});return {plan,result,requests};
}
describe('Astellas required PDF runtime capability',()=>{
 it.each(['missing-prlimit','missing-pdfinfo','missing-pdftotext','mismatched-version'])('retains the list and rows but blocks qualification when %s is unavailable',async mode=>{
  control.mode=mode;const c=await capture();expect(c.requests).toEqual([c.plan.source.officialEntryUrl]);
  expect(c.result.jobs).toHaveLength(1);expect(c.result.truth.completenessVerified).toBe(false);
  expect(c.result.fetchEvidence!.astellasPdfLocations!.runtimeCapability).toEqual({available:false,code:'PDF_RUNTIME_UNAVAILABLE'});
  expect(c.result.fetchEvidence!.artifacts).toHaveLength(1);
  expect(c.result.observation.completenessBlockerReason).toBe('ASTELLAS_PDF_RUNTIME_UNAVAILABLE');
 });
 it('keeps an unreadable individual PDF unresolved when the matched parser runtime is healthy',async()=>{
  control.mode='unreadable-document';const c=await capture();expect(c.requests).toHaveLength(2);
  expect(c.result.fetchEvidence!.astellasPdfLocations!.runtimeCapability).toMatchObject({available:true,parserVersion:expect.stringMatching(/^poppler-/u)});
  expect(c.result.jobs[0]!.evidence.astellasPdfLocation?.status).toBe('UNRESOLVED');expect(c.result.truth.completenessVerified).toBe(true);
 });
});
