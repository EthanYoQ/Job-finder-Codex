/** Entirely synthetic Moka transport fixtures. No saved official response or
 * business record. This helper never calls real fetch. */
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import type {MokaHttpClient,MokaHttpRequest} from '../../vendor/c60-source/src/crawler/mokaSourceFetch.ts';
export const HENGRUI_SYNTHETIC_IV='0123456789abcdef';
export const HENGRUI_SYNTHETIC_KEY='fedcba9876543210';
export const HENGRUI_SYNTHETIC_ENTRY='https://app.mokahr.com/social-recruitment/hengrui/145996#/jobs';
export const HENGRUI_SYNTHETIC_LIST='https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2';
export const HENGRUI_SYNTHETIC_DETAIL='https://app.mokahr.com/api/outer/ats-apply/website/job';
export const HENGRUI_SYNTHETIC_CN=[{country:'中国',cityName:'上海',provinceName:'上海',cityId:310000,provinceId:310000}];
export const HENGRUI_SYNTHETIC_US=[{country:'美国',cityName:'沃尔瑟姆',provinceName:'马萨诸塞州'}];
export const HENGRUI_SYNTHETIC_HK=[{country:'中国',cityName:'香港',provinceName:'香港',cityId:810000,provinceId:810000}];
export function encryptHengruiMoka(value:unknown):string{const cipher=createCipheriv('aes-128-cbc',HENGRUI_SYNTHETIC_KEY,HENGRUI_SYNTHETIC_IV);return JSON.stringify({data:cipher.update(JSON.stringify(value),'utf8','base64')+cipher.final('base64'),necromancer:HENGRUI_SYNTHETIC_KEY});}
export function syntheticHengruiRows(count=7):any[]{assert(Number.isSafeInteger(count)&&count>=0);return Array.from({length:count},(_,i)=>({id:`synthetic-${i+1}`,title:`Synthetic Hengrui Role ${i}`,locations:structuredClone(i===0?[{country:'中国',cityName:'北京',provinceName:'北京',cityId:110000,provinceId:110000}]:HENGRUI_SYNTHETIC_CN)}));}
export interface HengruiMokaSyntheticOptions {
 rows?:any[];count?:number;excludeUS?:boolean;excludeHK?:boolean;hydrateIds?:string[];
 duplicateId?:boolean;missingPageOffset?:number;totalByOffset?:Record<number,number>;missingDetailIds?:string[];
 detailLocations?:Record<string,any[]>;encryptedDetails?:boolean;now?:()=>Date;
 mutatePage?:(payload:any,offset:number)=>void;mutateDetail?:(payload:any,jobId:string)=>void;
}
export function createHengruiMokaSynthetic(options:HengruiMokaSyntheticOptions={}){
 const rows=structuredClone(options.rows??syntheticHengruiRows(options.count??7));
 if(options.excludeUS)rows.push({id:'synthetic-hengrui-us',title:'Synthetic Waltham Role',locations:structuredClone(HENGRUI_SYNTHETIC_US)});
 if(options.excludeHK)rows.push({id:'synthetic-hengrui-hk',title:'Synthetic Hong Kong Role',locations:structuredClone(HENGRUI_SYNTHETIC_HK)});
 const savedLocations=new Map(rows.map(r=>[String(r.id),structuredClone(r.locations??HENGRUI_SYNTHETIC_CN)]));
 for(const row of rows)if(options.hydrateIds?.includes(String(row.id)))row.locations=[];
 if(options.duplicateId&&rows.length>1)rows[rows.length-1].id=rows[0].id;
 const requests:MokaHttpRequest[]=[];
 const http:MokaHttpClient=async req=>{
  requests.push(structuredClone(req));const capturedAt=(options.now??(()=>new Date()))().toISOString();
  const entryUrl=req.url.split('#')[0]===HENGRUI_SYNTHETIC_ENTRY.split('#')[0];let status=200,body:string,contentType='application/json';
  if(req.method==='GET'&&entryUrl){assert.equal(req.body,undefined);contentType='text/html';body=`<input id="init-data" value='${JSON.stringify({aesIv:HENGRUI_SYNTHETIC_IV,mode:'social',siteId:'145996',org:{id:'hengrui'}})}'>`;}
  else if(req.method==='POST'&&req.url===HENGRUI_SYNTHETIC_LIST){
   const offset=Number(req.body?.offset);assert(Number.isSafeInteger(offset)&&offset>=0&&offset%50===0);assert.deepEqual(req.body,{orgId:'hengrui',siteId:'145996',limit:50,offset,needStat:true,isCampusJob:false,site:'social',locale:'zh-CN'});
   if(options.missingPageOffset===offset){status=404;body='{"syntheticMissingPage":true}';}
   else{const payload={success:true,data:{jobStats:{total:options.totalByOffset?.[offset]??rows.length},offset,jobs:structuredClone(rows.slice(offset,offset+50))}};options.mutatePage?.(payload,offset);body=encryptHengruiMoka(payload);}
  }else if(req.method==='POST'&&req.url===HENGRUI_SYNTHETIC_DETAIL){
   const jobId=String(req.body?.jobId);assert.deepEqual(req.body,{orgId:'hengrui',siteId:'145996',jobId,locale:'zh-CN'});
   if(options.missingDetailIds?.includes(jobId)||!savedLocations.has(jobId)){status=404;body='{"syntheticMissingDetail":true}';}
   else{const payload={id:jobId,orgId:'hengrui',siteId:'145996',locations:structuredClone(options.detailLocations?.[jobId]??savedLocations.get(jobId))};options.mutateDetail?.(payload,jobId);body=options.encryptedDetails?encryptHengruiMoka({success:true,data:payload}):JSON.stringify(payload);}
  }else throw Error('SYNTHETIC_UNEXPECTED_REQUEST:'+req.method+':'+req.url);
  return {status,body,finalUrl:req.url,contentType,capturedAt};
 };
 const fetch=async(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>=>{
  const request=input instanceof Request?input:undefined,url=request?.url??String(input),method=String(init.method??request?.method??'GET');assert(method==='GET'||method==='POST');
  const bodyValue=init.body??(request?await request.text():undefined);const body=bodyValue?JSON.parse(String(bodyValue)):undefined;
  const result=await http({url,method,headers:Object.fromEntries(new Headers(init.headers??request?.headers).entries()),...(body?{body}:{})});
  const response=new Response(result.body,{status:result.status,headers:{'content-type':result.contentType!}});Object.defineProperty(response,'url',{value:result.finalUrl});return response;
 };
 return {rows,requests,http,fetch};
}
