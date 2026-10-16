import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {TARGET,EXISTING_CONSENT_LABEL} from '../public-verification/contract.mjs';
import {createCuaBrowserPort} from '../public-verification/cua-port.mjs';
import {job} from '../public-verification/test/synthetic.mjs';
export function fixture(e,{stale=false,stillStale=false,consent=false,mutateAx=null,mutateTool=null}={}) {
  let reloads=0,accepted=!consent,checked=false,view=accepted?'jobs':'consent',expanded=false,all=false,filtered=false,indexBase=0;
  let currentControls=[];const calls=[];const evaluates=[];
  const jobs=()=>[...e.jobs,...((reloads?stillStale:stale)?e.removedIds.map(job):[])];
  const c=(role,name,{disabled=false,checked=null,value=null}={})=>({index:++indexBase,role,name,disabled,checked,value});
  const ax=()=>{
    indexBase+=100;
    const controls=view==='consent'?[c('checkbox',EXISTING_CONSENT_LABEL,{checked}),c('link','隐私政策',{value:'job.orz.md/privacy'}),c('link','服务条款',{value:'job.orz.md/terms'}),c('button','进入 Job-search',{disabled:!checked})]:
      [c('button','官方招聘目录'),...(view==='jobs'?[c('button',`E5 武田中国 ${jobs().length} 个职位`),...(expanded&&!all?[c('button',`查看全部 ${jobs().length} 个职位`)]:[])]:[c('searchbox','搜索已覆盖公司')])];
    currentControls=controls;
    const s={websiteUrl:TARGET.websiteUrl,view,state:'READY',errorBanner:false,consentAccepted:accepted,materialChangeNotice:false,
      recognizedExistingFlow:true,companyExpanded:expanded,allJobsVisible:all,directoryFiltered:filtered,controls};
    mutateAx?.(s,calls);return {fixtureKind:'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA',snapshot:s};
  };
  const document={querySelectorAll(selector){
    if(selector==='a')return jobs().map(j=>({href:j.officialUrl,getClientRects:()=>[{}],getAttribute:()=>`查看官方职位 ${j.officialTitle}`,textContent:j.officialTitle}));
    if(selector==='#jobs-company-takeda-china .job')return jobs().map(j=>({getClientRects:()=>[{}],querySelector:s=>s==='a'?{href:j.officialUrl}:{innerText:j.officialTitle}}));
    throw Error('Unknown selector');
  },getElementById(id){assert.equal(id,'row-company-takeda-china');return {getClientRects:()=>[{}],innerText:'E5\n武田中国\n最近成功更新 '+e.observedAt.slice(0,16).replace('T',' ')+' UTC\n官方招聘入口',querySelector:s=>{assert.equal(s,'a');return {href:TARGET.officialEntry};}};}};
  const tab={async getAXState(){return ax();},async click(index){
    const control=currentControls.find(c=>c.index===index);assert(control,'Only a fresh AX index may be clicked');assert(!control.disabled);
    if(control.role==='checkbox')checked=true;
    else if(control.name==='进入 Job-search'){accepted=true;view='jobs';}
    else if(control.name.startsWith('E5 '))expanded=true;
    else if(control.name.startsWith('查看全部 '))all=true;
    else throw Error('Unexpected index click');
  },async reload(){reloads++;accepted=!consent;checked=false;view=accepted?'jobs':'consent';expanded=false;all=false;filtered=false;},playwright:{
    getByRole(role,options){
      if(role==='button'){assert.deepEqual(JSON.parse(JSON.stringify(options)),{name:'官方招聘目录',exact:true});return {async click(){view='directory';expanded=false;all=false;filtered=false;}};}
      assert.equal(role,'searchbox');assert.equal(options.name,'搜索已覆盖公司');return {async fill(value){assert.equal(value,'武田');filtered=true;}};
    },async evaluate(fn,...args){assert.equal(typeof fn,'function');assert.equal(args.length,0);evaluates.push(fn.toString());return fn();}
  }};
  const context={cua:{async createBrowserTab(browser,url){assert.equal(browser,'cdp');assert.equal(url,'https://job.orz.md');context.__jobfinder_public_ui_v2_tab=tab;return tab;}},document,nodeRepl:{write(){throw Error('write not bound');}}};
  const toolCall=async request=>{
    calls.push(request);let output=[];context.nodeRepl.write=value=>output.push({type:'text',text:value});
    await runInNewContext(`(async()=>{${request.code}})()`,context);
    let response=output.length?{content:output}:{fixtureKind:'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA'};
    if(mutateTool)response=mutateTool(response,request,calls)??response;
    return response;
  };
  const decoder={kind:'REVIEWED_ACTUAL_AX_DECODER', // Test injection; not a claim of real qualification.
    assertStartupResult(r){assert.equal(r.fixtureKind,'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA');},
    decodeAx(raw){assert.equal(raw.fixtureKind,'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA');return raw.snapshot;}};
  return {port:createCuaBrowserPort({enabled:true,toolCall,decoder}),calls,evaluates,ax,decoder,toolCall};
}