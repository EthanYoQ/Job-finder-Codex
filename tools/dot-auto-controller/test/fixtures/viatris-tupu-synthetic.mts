/** Synthetic external HTTP port only. Uses original Tupu requests; never reaches a website. */
import assert from 'node:assert/strict';
import type {HttpHtmlClient} from '../../vendor/c60-source/src/crawler/httpHtmlSourceFetch.ts';
export const VIATRIS_SYNTHETIC_ENTRY='https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT';
export const VIATRIS_SYNTHETIC_PAGE='https://careersite.tupu360.com/Viatris/position/nextPageList';
export interface ViatrisSyntheticOptions {count?:number;pageSize?:number;declaredPages?:number;duplicateId?:boolean;omitDeclaration?:boolean;omitPageSize?:boolean;wrongAction?:boolean;pageSizeDrift?:boolean;missingPageOffset?:number;now?:()=>Date;}
export function createViatrisTupuSynthetic(options:ViatrisSyntheticOptions={}){
 const count=options.count??7,pageSize=options.pageSize??10;
 assert(Number.isSafeInteger(count)&&count>=0);assert(Number.isSafeInteger(pageSize)&&pageSize>0);
 const ids=Array.from({length:count},(_,i)=>`synthetic-${i+1}`);
 if(options.duplicateId&&ids.length>1)ids[ids.length-1]=ids[0]!;
 const pages=options.declaredPages??Math.max(1,Math.ceil(count/pageSize));
 const requests:Parameters<HttpHtmlClient>[0][]=[];
 const http:HttpHtmlClient=async req=>{
  requests.push(structuredClone(req));let offset=0,status=200;
  if((req.method??'GET')==='GET'&&req.url===VIATRIS_SYNTHETIC_ENTRY)assert.equal(req.body,undefined);
  else if(req.method==='POST'&&req.url===VIATRIS_SYNTHETIC_PAGE){
   const body=new URLSearchParams(req.body);offset=Number(body.get('offset'));
   assert(Number.isSafeInteger(offset)&&offset>0&&offset%pageSize===0);
   assert.deepEqual([...body.entries()],[['offset',String(offset)],['max',String(pageSize)],['recruitmentType','SOCIALRECRUITMENT']]);
   assert.equal(new Headers(req.headers).get('referer'),VIATRIS_SYNTHETIC_ENTRY);assert.equal(new Headers(req.headers).get('x-requested-with'),'XMLHttpRequest');
   assert.equal(new Headers(req.headers).get('content-type'),'application/x-www-form-urlencoded; charset=UTF-8');
   if(options.missingPageOffset===offset)status=404;
  }else throw Error('SYNTHETIC_UNEXPECTED_REQUEST:'+(req.method??'GET')+':'+req.url);
  const rows=ids.slice(offset,offset+pageSize).map(id=>`<div class="position-item"><div class="e-title"><a href="/Viatris/position/detail?positionId=${id}">Synthetic Viatris Role ${id.slice(10)}</a></div><div class="e-city">上海</div></div>`).join('');
  const size=options.pageSizeDrift&&offset>0?pageSize+1:pageSize;
  const declaration=options.omitDeclaration?'':`<ul id="pageTurnUl"><li>共${pages}页</li>${options.omitPageSize?'':`<li data-action="${options.wrongAction?'wrong':'pageTurn'}" data-pagenum="${Math.min(pages,2)}" data-pagemax="${size}">2</li>`}</ul>`;
  return {status,body:status===200?`<div class="position-list-body">${rows}</div>${declaration}`:'Synthetic missing page',finalUrl:req.url,contentType:'text/html; charset=UTF-8',capturedAt:(options.now??(()=>new Date()))().toISOString()};
 };
 const fetch=async(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>=>{
  const request=input instanceof Request?input:undefined,url=request?.url??String(input),method=String(init.method??request?.method??'GET');assert(method==='GET'||method==='POST');
  const body=init.body??(request?await request.text():undefined),result=await http({url,method,headers:Object.fromEntries(new Headers(init.headers??request?.headers).entries()),...(body?{body:String(body)}:{})});
  const response=new Response(result.body,{status:result.status,headers:{'content-type':result.contentType!}});Object.defineProperty(response,'url',{value:result.finalUrl});return response;
 };
 return {ids,requests,http,fetch};
}
