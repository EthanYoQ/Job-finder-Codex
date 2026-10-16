import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {TARGET,EXISTING_CONSENT_LABEL} from '../../public-verification/ucb/contract.mjs';
import {createCuaBrowserPort} from '../../public-verification/ucb/cua-port.mjs';
import {ACTUAL_PUBLIC_UI_DECODER} from '../../public-verification/ucb/actual-ax.mjs';
import {job} from '../../public-verification/ucb/test/synthetic.mjs';
const observed=JSON.parse(readFileSync(new URL('../../public-verification/test/observed-ax-grammar.json',import.meta.url),'utf8').replaceAll('company-takeda-china','company-ucb-china').replaceAll('武田中国','优时比中国').replaceAll('武田','优时比').replaceAll('E5','E6')).samples;
// Every UCB browser input below is synthetic. The shared grammar alone was
// observed earlier; replaying it does not qualify a real UCB site or session.
export function fixture(e,{stale=false,stillStale=false,consent=false,actualAx=false,mutateAx=null,mutateTool=null}={}) {
  let reloads=0,accepted=!consent,checked=false,view=accepted?'jobs':'consent',expanded=false,all=false,filtered=false,indexBase=0;
  let currentControls=[];const calls=[];const evaluates=[];
  const jobs=()=>[...e.jobs,...((reloads?stillStale:stale)?e.removedIds.map(job):[])];
  const c=(role,name,{disabled=false,checked=null,value=null}={})=>({index:++indexBase,role,name,disabled,checked,value});
  const ax=()=>{
    indexBase+=100;
    if(actualAx){
      let text=observed[view==='consent'?'consent':view==='directory'?'directoryReady':expanded?'jobsExpanded':'jobsReady'];
      if(view==='consent'&&checked)text=text.replace('服务条款, Value: 0','服务条款, Value: 1').replace('button (disabled) 进入 Job-search','button 进入 Job-search');
      if(view==='directory'&&!filtered)text=text.replace('Description: 搜索已覆盖公司, Value: 优时比','搜索已覆盖公司');
      if(view==='jobs'){
        text=text.replaceAll('116',String(jobs().length));
        if(!jobs().length)text=text.split('\n').filter(line=>!line.includes('E6 优时比中国')).join('\n');
        if(all)text=text.split('\n').filter(line=>!line.includes('button 查看全部')).join('\n');
      }
      text=text.replace(/^(\t*)(\d+) /gm,(_,indent,id)=>indent+(indexBase+Number(id))+' ');
      let raw='Browser tab: 0, Title: "Job-search | 中国医药官方职位聚合", URL: "https://job.orz.md/".\n'+text;
      raw=mutateAx?.(raw,calls)??raw;
      currentControls=ACTUAL_PUBLIC_UI_DECODER.decodeAx(raw).controls;return raw;
    }
    const controls=view==='consent'?[c('checkbox',EXISTING_CONSENT_LABEL,{checked}),c('link','隐私政策',{value:'job.orz.md/privacy'}),c('link','服务条款',{value:'job.orz.md/terms'}),c('button','进入 Job-search',{disabled:!checked})]:
      [c('button','官方招聘目录'),...(view==='jobs'?[...(jobs().length?[c('button',`E6 优时比中国 ${jobs().length} 个职位`)]:[]),...(expanded&&!all?[c('button',`查看全部 ${jobs().length} 个职位`)]:[])]:[c('searchbox','搜索已覆盖公司')])];
    currentControls=controls;
    const s={websiteUrl:TARGET.websiteUrl,view,state:'READY',errorBanner:false,consentAccepted:accepted,materialChangeNotice:false,
      recognizedExistingFlow:true,companyExpanded:expanded,allJobsVisible:all,directoryFiltered:filtered,controls};
    mutateAx?.(s,calls);return {fixtureKind:'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA',snapshot:s};
  };
  const document={querySelectorAll(selector){
    if(selector==='#jobs-company-ucb-china .job a')return jobs().map(j=>({href:j.officialUrl,getClientRects:()=>[{}],getAttribute:()=>`查看官方职位 ${j.officialTitle}`,textContent:j.officialTitle}));
    if(selector==='#jobs-company-ucb-china .job')return jobs().map(j=>({getClientRects:()=>[{}],querySelector:s=>s==='a'?{href:j.officialUrl}:{innerText:j.officialTitle}}));
    throw Error('Unknown selector');
  },getElementById(id){assert.equal(id,'row-company-ucb-china');if(view==='jobs'&&!jobs().length)return null;return {getClientRects:()=>[{}],innerText:'E6\n优时比中国\n最近成功更新 '+e.observedAt.slice(0,16).replace('T',' ')+' UTC\n官方招聘入口',querySelector:s=>{assert.equal(s,'a');return {href:TARGET.officialEntry};}};}};
  const tab={async getAXState(){return ax();},async click(index){
    const control=currentControls.find(c=>c.index===index);assert(control,'Only a fresh AX index may be clicked');assert(!control.disabled);
    if(control.role==='checkbox')checked=true;
    else if(control.name==='进入 Job-search'){accepted=true;view='jobs';}
    else if(control.name.startsWith('E6 '))expanded=true;
    else if(control.name.startsWith('查看全部 '))all=true;
    else throw Error('Unexpected index click');
  },async reload(){reloads++;accepted=!consent;checked=false;view=accepted?'jobs':'consent';expanded=false;all=false;filtered=false;},playwright:{
    getByRole(role,options){
      if(role==='button'){assert.deepEqual(JSON.parse(JSON.stringify(options)),{name:'官方招聘目录',exact:true});return {async click(){view='directory';expanded=false;all=false;filtered=false;}};}
      assert.equal(role,'searchbox');assert.equal(options.name,'搜索已覆盖公司');return {async fill(value){assert.equal(value,'优时比');filtered=true;}};
    },async evaluate(fn,...args){assert.equal(typeof fn,'function');assert.equal(args.length,0);evaluates.push(fn.toString());return fn();}
  }};
  const context={cua:{async createBrowserTab(browser,url){assert.equal(browser,'cdp');assert.equal(url,'https://job.orz.md');context.__jobfinder_public_ui_v2_tab=tab;return tab;}},document,nodeRepl:{write(){throw Error('write not bound');}}};
  const toolCall=async request=>{
    calls.push(request);let output=[];context.nodeRepl.write=value=>output.push({type:'text',text:value});
    await runInNewContext(`(async()=>{${request.code}})()`,context);
    let response=output.length?{content:output}:actualAx?{isError:false,content:[{type:'text',text:ax()}]}:{fixtureKind:'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA'};
    if(mutateTool)response=mutateTool(response,request,calls)??response;
    return response;
  };
  const decoder=actualAx?ACTUAL_PUBLIC_UI_DECODER:{kind:'REVIEWED_ACTUAL_AX_DECODER', // Test injection; not a claim of real qualification.
    assertStartupResult(r){assert.equal(r.fixtureKind,'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA');},
    decodeAx(raw){assert.equal(raw.fixtureKind,'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA');return raw.snapshot;}};
  return {port:createCuaBrowserPort({enabled:true,toolCall,decoder,expected:e}),calls,evaluates,ax,decoder,toolCall};
}
