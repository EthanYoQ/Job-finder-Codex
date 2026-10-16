/** Synthetic external HTTP port only. Never falls back to live fetch. */
import assert from 'node:assert/strict';
import type {OfficialJsonHttpClient} from '../../vendor/c60-source/src/crawler/officialJsonSourceFetch.ts';
export const UCB_SYNTHETIC_ENTRY='https://careers.ucb.com/global/zh/search-results?keywords=China';
export const UCB_SYNTHETIC_WIDGET='https://careers.ucb.com/widgets';
export const UCB_SYNTHETIC_BOOTSTRAP={widgetApiEndpoint:UCB_SYNTHETIC_WIDGET,country:'global',deviceType:'desktop',locale:'zh_global',refNum:'UCB1GLOBAL',pageName:'search-results',pageId:'page17'};
export function syntheticUcbRows(count=7):any[]{assert(Number.isSafeInteger(count)&&count>=0);return Array.from({length:count},(_,i)=>({jobSeqNo:`UCB1GLOBALSYNTHETIC${i+1}EXTERNALZHGLOBAL`,jobId:`synthetic-${i+1}`,reqId:`synthetic-${i+1}`,title:`Synthetic UCB Role ${i}`,location:'Shanghai, Shanghai, China',city:'Shanghai',country:'China',postedDate:'2026-08-24T05:54:14.000+0000',dateCreated:'2026-09-30T12:15:38.356+0000'}));}
export function ucbExpectedRequest(from:number){return {lang:'zh_global',locale:'zh_global',deviceType:'desktop',country:'global',pageName:'search-results',size:50,from,jobs:true,counts:true,all_fields:['category','country','state','city','type','jobLevelId'],clearAll:false,jdsource:'facets',isSliderEnable:false,pageId:'page17',siteType:'external',keywords:'',global:true,selected_fields:{country:['China']},sort:{order:'desc',field:'postedDate'},locationData:{},refNum:'UCB1GLOBAL',ddoKey:'refineSearch'};}
export interface UcbPhenomSyntheticOptions{rows?:any[];count?:number;bootstrap?:Record<string,unknown>;duplicateId?:boolean;omitOffset?:boolean;missingPageOffset?:number;totalByOffset?:Record<number,number>;now?:()=>Date;mutatePage?:(payload:any,offset:number)=>void;}
export function createUcbPhenomSynthetic(options:UcbPhenomSyntheticOptions={}){
 const rows=structuredClone(options.rows??syntheticUcbRows(options.count??7));
 if(options.duplicateId&&rows.length>1){rows[rows.length-1].jobSeqNo=rows[0].jobSeqNo;rows[rows.length-1].jobId=rows[0].jobId;rows[rows.length-1].reqId=rows[0].reqId;}
 const requests:any[]=[];
 const http:OfficialJsonHttpClient=async req=>{
  requests.push(structuredClone(req));const capturedAt=(options.now??(()=>new Date()))().toISOString();let body:string,status=200,contentType='application/json';
  if(req.method==='GET'&&req.url===UCB_SYNTHETIC_ENTRY){assert.equal(req.body,undefined);contentType='text/html';body=`<script>var phApp=${JSON.stringify({...UCB_SYNTHETIC_BOOTSTRAP,...options.bootstrap})};</script>`;}
  else if(req.method==='POST'&&req.url===UCB_SYNTHETIC_WIDGET){
   const actual=JSON.parse(req.body!),offset=actual.from;assert(Number.isSafeInteger(offset)&&offset>=0&&offset%50===0);assert.deepEqual(actual,ucbExpectedRequest(offset));
   if(options.missingPageOffset===offset){status=404;body='{"syntheticMissingPage":true}';}
   else{const payload={refineSearch:{totalHits:options.totalByOffset?.[offset]??rows.length,...(options.omitOffset?{}:{from:offset}),data:{jobs:structuredClone(rows.slice(offset,offset+50)),aggregations:[]}}};options.mutatePage?.(payload,offset);body=JSON.stringify(payload);}
  }else throw Error('SYNTHETIC_UNEXPECTED_REQUEST:'+req.method+':'+req.url);
  return {status,body,finalUrl:req.url,contentType,capturedAt};
 };
 const fetch=async(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>=>{
  const request=input instanceof Request?input:undefined,url=request?.url??String(input),method=String(init.method??request?.method??'GET');assert(method==='GET'||method==='POST');
  const body=init.body??(request?await request.text():undefined);const result=await http({url,method,headers:Object.fromEntries(new Headers(init.headers??request?.headers).entries()),...(body?{body:String(body)}:{})});
  const response=new Response(result.body,{status:result.status,headers:{'content-type':result.contentType!}});Object.defineProperty(response,'url',{value:result.finalUrl});return response;
 };
 return {rows,requests,http,fetch};
}
