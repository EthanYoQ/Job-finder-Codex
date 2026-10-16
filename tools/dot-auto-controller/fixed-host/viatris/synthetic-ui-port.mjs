import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {TARGET,EXISTING_CONSENT_LABEL} from '../../public-verification/viatris/contract.mjs';
import {createCuaBrowserPort} from '../../public-verification/viatris/cua-port.mjs';
import {ACTUAL_PUBLIC_UI_DECODER} from '../../public-verification/viatris/actual-ax.mjs';
import {job} from '../../public-verification/viatris/test/synthetic.mjs';
const observed=JSON.parse(readFileSync(new URL('../../public-verification/test/observed-ax-grammar.json',import.meta.url),'utf8').replaceAll('company-takeda-china','company-viatris').replaceAll('武田中国','晖致中国').replaceAll('武田','晖致').replaceAll('E5','B6')).samples;
// Every Viatris browser input below is synthetic. The shared grammar alone was
// observed earlier; replaying it does not qualify a real Viatris site or session.
export function fixture(e,{stale=false,stillStale=false,consent=false,actualAx=false,mutateAx=null,mutateTool=null,mutateDom=null}={}) {
  let reloads=0,accepted=!consent,checked=false,view=accepted?'jobs':'consent',expanded=false,all=false,filtered=false,indexBase=0;
  let currentControls=[];const calls=[];const evaluates=[];
  const jobs=()=>[...e.jobs,...((reloads?stillStale:stale)?e.removedIds.map(job):[])];
  const c=(role,name,{disabled=false,checked=null,value=null}={})=>({index:++indexBase,role,name,disabled,checked,value});
  const ax=()=>{
    indexBase+=100;
    if(actualAx){
      let text=observed[view==='consent'?'consent':view==='directory'?'directoryReady':expanded?'jobsExpanded':'jobsReady'];
      if(view==='consent'&&checked)text=text.replace('服务条款, Value: 0','服务条款, Value: 1').replace('button (disabled) 进入 Job-search','button 进入 Job-search');
      if(view==='directory'&&!filtered)text=text.replace('Description: 搜索已覆盖公司, Value: 晖致','搜索已覆盖公司');
      if(view==='jobs'){
        text=text.replaceAll('116',String(jobs().length));
        if(!jobs().length)text=text.split('\n').filter(line=>!line.includes('B6 晖致中国')).join('\n');
        if(all)text=text.split('\n').filter(line=>!line.includes('button 查看全部')).join('\n');
      }
      text=text.replace(/^(\t*)(\d+) /gm,(_,indent,id)=>indent+(indexBase+Number(id))+' ');
      let raw='Browser tab: 0, Title: "Job-search | 中国医药官方职位聚合", URL: "https://job.orz.md/".\n'+text;
      raw=mutateAx?.(raw,calls)??raw;
      currentControls=ACTUAL_PUBLIC_UI_DECODER.decodeAx(raw).controls;return raw;
    }
    const controls=view==='consent'?[c('checkbox',EXISTING_CONSENT_LABEL,{checked}),c('link','隐私政策',{value:'job.orz.md/privacy'}),c('link','服务条款',{value:'job.orz.md/terms'}),c('button','进入 Job-search',{disabled:!checked})]:
      [c('button','官方招聘目录'),...(view==='jobs'?[...(jobs().length?[c('button',`B6 晖致中国 ${jobs().length} 个职位`)]:[]),...(expanded&&!all?[c('button',`查看全部 ${jobs().length} 个职位`)]:[])]:[c('searchbox','搜索已覆盖公司')])];
    currentControls=controls;
    const s={websiteUrl:TARGET.websiteUrl,view,state:'READY',errorBanner:false,consentAccepted:accepted,materialChangeNotice:false,
      recognizedExistingFlow:true,companyExpanded:expanded,allJobsVisible:all,directoryFiltered:filtered,controls};
    mutateAx?.(s,calls);return {fixtureKind:'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA',snapshot:s};
  };
  const visible=(extra={})=>({parentElement:null,hidden:false,inert:false,getClientRects:()=>[{}],getAttribute:()=>null,...extra});
  const document={querySelectorAll(selector){
    assert.equal(selector,'#jobs-company-viatris .job');
    const elements=jobs().map(j=>{
      const anchor=visible({href:j.officialUrl}),title=visible({innerText:j.officialTitle});
      return visible({querySelectorAll(s){if(s==='a')return [anchor];if(s==='p.en')return [title];throw Error('Unknown row selector');}});
    });
    return mutateDom?.(elements,jobs(),calls)??elements;
  },getElementById(id){assert.equal(id,'row-company-viatris');if(view==='jobs'&&!jobs().length)return null;return visible({innerText:'B6\n晖致中国\n最近成功更新 '+e.observedAt.slice(0,16).replace('T',' ')+' UTC\n官方招聘入口',querySelector:s=>{assert.equal(s,'a');return visible({href:TARGET.officialEntry});},querySelectorAll:s=>{assert.equal(s,'a');return [visible({href:TARGET.officialEntry})];}});}};
  const tab={async getAXState(){return ax();},async click(index){
    const control=currentControls.find(c=>c.index===index);assert(control,'Only a fresh AX index may be clicked');assert(!control.disabled);
    if(control.role==='checkbox')checked=true;
    else if(control.name==='进入 Job-search'){accepted=true;view='jobs';}
    else if(control.name.startsWith('B6 '))expanded=true;
    else if(control.name.startsWith('查看全部 '))all=true;
    else throw Error('Unexpected index click');
  },async reload(){reloads++;accepted=!consent;checked=false;view=accepted?'jobs':'consent';expanded=false;all=false;filtered=false;},playwright:{
    getByRole(role,options){
      if(role==='button'){assert.deepEqual(JSON.parse(JSON.stringify(options)),{name:'官方招聘目录',exact:true});return {async click(){view='directory';expanded=false;all=false;filtered=false;}};}
      assert.equal(role,'searchbox');assert.equal(options.name,'搜索已覆盖公司');return {async fill(value){assert.equal(value,'晖致');filtered=true;}};
    },async evaluate(fn,...args){assert.equal(typeof fn,'function');assert.equal(args.length,0);evaluates.push(fn.toString());return fn();}
  }};
  const context={cua:{async createBrowserTab(browser,url){assert.equal(browser,'cdp');assert.equal(url,'https://job.orz.md');context.__jobfinder_viatris_public_ui_v1_tab=tab;return tab;}},document,getComputedStyle:n=>n.style??({display:'block',visibility:'visible',opacity:'1'}),nodeRepl:{write(){throw Error('write not bound');}}};
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
