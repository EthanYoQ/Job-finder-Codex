/** Synthetic browser transport only. No real Viatris AX/DOM capture is claimed. */
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {TARGET} from '../contract.mjs';
import {createCuaBrowserPort} from '../cua-port.mjs';
import {ACTUAL_PUBLIC_UI_DECODER} from '../actual-ax.mjs';
const samples=JSON.parse(readFileSync(new URL('../../test/observed-ax-grammar.json',import.meta.url),'utf8')).samples;
const adapted=Object.fromEntries(Object.entries(samples).map(([k,s])=>[k,s.replaceAll('company-takeda-china','company-viatris').replaceAll('武田中国','晖致中国').replaceAll('武田','晖致').replaceAll('E5','B6')]));
export function fixture(expected,{consent=false,mutateRow=null,mutateCard=null,mutateAx=null,mutateTool=null,rows=null,companyPresent=true}={}) {
 let checked=false,view=consent?'consent':'jobs',expanded=false,all=false,filtered=false,indexBase=0;
 let controls=[];const calls=[],evaluates=[];
 const jobs=rows??expected.jobs;
 const ax=()=>{
  indexBase+=100;
  let text=adapted[view==='consent'?'consent':view==='directory'?'directoryReady':expanded?'jobsExpanded':'jobsReady'];
  if(view==='consent'&&checked)text=text.replace('服务条款, Value: 0','服务条款, Value: 1').replace('button (disabled) 进入 Job-search','button 进入 Job-search');
  if(view==='directory'&&!filtered)text=text.replace('Description: 搜索已覆盖公司, Value: 晖致','搜索已覆盖公司');
  if(view==='jobs'){
   text=text.replaceAll('116',String(jobs.length));
   if(!companyPresent)text=text.split('\n').filter(line=>!line.includes('B6 晖致中国')).join('\n');
   if(all)text=text.split('\n').filter(line=>!line.includes('button 查看全部')).join('\n');
  }
  text=text.replace(/^(\t*)(\d+) /gm,(_,indent,id)=>indent+(indexBase+Number(id))+' ');
  let raw='Browser tab: 0, Title: "Job-search | 中国医药官方职位聚合", URL: "https://job.orz.md/".\n'+text;
  raw=mutateAx?.(raw,calls)??raw;controls=ACTUAL_PUBLIC_UI_DECODER.decodeAx(raw).controls;return raw;
 };
 const element=props=>({parentElement:null,hidden:false,inert:false,getAttribute:()=>null,getClientRects:()=>[{}],...props});
 const document={querySelectorAll(selector){
  assert.equal(selector,'#jobs-company-viatris .job');
  return jobs.map((job,index)=>{
   const anchor=element({href:job.officialUrl,getAttribute:name=>name==='aria-label'?'查看官方职位 完全不同的中文译名':null,textContent:'查看官方职位'});
   const title=element({innerText:job.officialTitle});
   const row=element({anchors:[anchor],titles:[title],querySelectorAll(s){if(s==='a')return this.anchors;if(s==='p.en')return this.titles;throw Error('Unexpected selector '+s);}});
   anchor.parentElement=row;title.parentElement=row;
   mutateRow?.(row,index,job);return row;
  });
 },getElementById(id){
  assert.equal(id,'row-company-viatris');if(!companyPresent)return null;
  const card=element({innerText:'B6\n晖致中国\n最近成功更新 '+expected.observedAt.slice(0,16).replace('T',' ')+' UTC\n官方招聘入口',
   anchors:[element({href:TARGET.officialEntry})],querySelectorAll(s){assert.equal(s,'a');return this.anchors;}});
  card.anchors[0].parentElement=card;if(view==='directory')mutateCard?.(card);return card;
 }};
 const tab={async getAXState(options){assert.equal(options.disableDiffing,true);return ax();},async click(index){
  const control=controls.find(c=>c.index===index);assert(control,'Click must resolve a fresh index');assert(!control.disabled);
  if(control.role==='checkbox')checked=true;
  else if(control.name==='进入 Job-search')view='jobs';
  else if(control.name.startsWith('B6 晖致中国 '))expanded=true;
  else if(control.name.startsWith('查看全部 '))all=true;
  else throw Error('Unexpected click');
 },async reload(){view=consent?'consent':'jobs';checked=false;expanded=false;all=false;filtered=false;},playwright:{
  getByRole(role,options){
   if(role==='button'){assert.deepEqual(JSON.parse(JSON.stringify(options)),{name:'官方招聘目录',exact:true});return {async click(){view='directory';expanded=false;all=false;filtered=false;}};}
   assert.equal(role,'searchbox');assert.equal(options.name,'搜索已覆盖公司');return {async fill(value){assert.equal(value,'晖致');filtered=true;}};
  },async evaluate(fn,...args){assert.equal(args.length,0);evaluates.push(fn.toString());return fn();}
 }};
 const context={cua:{async createBrowserTab(browser,url){assert.equal(browser,'cdp');assert.equal(url,'https://job.orz.md');context.__jobfinder_viatris_public_ui_v1_tab=tab;return tab;}},document,
  getComputedStyle:e=>({display:'block',visibility:'visible',opacity:'1',...e.style}),nodeRepl:{write(){throw Error('unbound write');}}};
 const toolCall=async request=>{
  calls.push(request);const output=[];context.nodeRepl.write=text=>output.push({type:'text',text});
  await runInNewContext(`(async()=>{${request.code}})()`,context);
  let response=output.length?{content:output}:{isError:false,content:[{type:'text',text:ax()}]};
  return mutateTool?.(response,request,calls)??response;
 };
 return {port:createCuaBrowserPort({enabled:true,toolCall,expected}),calls,evaluates,toolCall};
}
