import {TARGET,EXISTING_CONSENT_LABEL,requireFact,VerificationHold} from './contract.mjs';

// Grammar was observed on job.orz.md in the dot cloud browser on 2026-10-11.
// Full-state mode is mandatory; diffs/no-change strings cannot provide fresh controls.
const HEADER = /^Browser tab: \d+, Title: "Job-search \| 中国医药官方职位聚合", URL: "https:\/\/job\.orz\.md\/"\.$/;
const NODE = /^(\t*)(\d+) (AXWebArea|search text field|combo box|content list|definition list|checkbox|button|link|container|text|image|heading)(?: \(([^)]*)\))?(?: (.*))?$/;
const ROOT = 'Job-search | 中国医药官方职位聚合, URL: job.orz.md/';
const CONSENT_SURFACE_BASELINE = [{"depth":0,"role":"AXWebArea","flags":"","body":"Job-search | 中国医药官方职位聚合, URL: job.orz.md/"},{"depth":1,"role":"container","flags":"","body":"使用前确认"},{"depth":2,"role":"container","flags":"","body":""},{"depth":3,"role":"button","flags":"","body":"关闭确认弹窗"},{"depth":4,"role":"image","flags":"","body":""},{"depth":3,"role":"image","flags":"","body":""},{"depth":3,"role":"heading","flags":"","body":"使用前确认, Value: 2"},{"depth":4,"role":"text","flags":"","body":"使用前确认"},{"depth":2,"role":"text","flags":"","body":"先完成同意，前台才会请求职位搜索结果。"},{"depth":2,"role":"container","flags":"","body":""},{"depth":3,"role":"checkbox","flags":"settable, integer","body":"Description: 我已阅读并同意 隐私政策 和 服务条款, Value: 0"},{"depth":3,"role":"image","flags":"","body":""},{"depth":3,"role":"text","flags":"","body":"我已阅读并同意 "},{"depth":3,"role":"link","flags":"","body":"Description: 隐私政策, Value: job.orz.md/privacy"},{"depth":3,"role":"text","flags":"","body":" 和 "},{"depth":3,"role":"link","flags":"","body":"Description: 服务条款, Value: job.orz.md/terms"},{"depth":2,"role":"button","flags":"disabled","body":"进入 Job-search"},{"depth":3,"role":"text","flags":"","body":"进入 Job-search"},{"depth":3,"role":"image","flags":"","body":""}];
function requireExistingConsentSurface(nodes) {
  const checkbox=one(nodes,n=>n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL,'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  const entry=one(nodes,n=>n.role==='button'&&n.name==='进入 Job-search','CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  requireFact(['0','1'].includes(checkbox.value)&&entry.flags===(checkbox.value==='0'?'disabled':''),'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  const actual=nodes.map(n=>({depth:n.depth,role:n.role,flags:n.role==='button'&&n.name==='进入 Job-search'?'disabled':n.flags,
    body:n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL?n.body.replace(/, Value: [01]$/,', Value: 0'):n.body}));
  // Exact observed visible wording, order and hierarchy. This is not a legal-document hash.
  requireFact(JSON.stringify(actual)===JSON.stringify(CONSENT_SURFACE_BASELINE),'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
}
function bodyParts(body='') {
  const withoutActions=body.replace(/, Secondary Actions: (Expand|Collapse)$/,'');
  const split=withoutActions.indexOf(', Value: ');
  return {name:(split<0?withoutActions:withoutActions.slice(0,split)).replace(/^Description: /,''),
    value:split<0?null:withoutActions.slice(split+9)};
}
function one(nodes,predicate,code){const found=nodes.filter(predicate);requireFact(found.length===1,code);return found[0];}

export function decodeActualAx(raw) {
  requireFact(typeof raw==='string'&&raw.length>0&&raw.length<=4_000_000,'UNKNOWN_ACTUAL_AX_FORMAT');
  const lines=raw.split('\n');requireFact(HEADER.test(lines[0]),'UNKNOWN_ACTUAL_AX_HEADER');
  const nodes=[],indices=new Set();
  for(const line of lines.slice(1)) {
    if(!line||line.startsWith('The focused UI element is '))continue;
    const m=line.match(NODE);requireFact(m,'UNKNOWN_ACTUAL_AX_LINE');
    const index=Number(m[2]);requireFact(Number.isSafeInteger(index)&&!indices.has(index),'DUPLICATE_ACTUAL_AX_INDEX');indices.add(index);
    const {name,value}=bodyParts(m[5]),role=m[3],flags=m[4]??'';
    // Only modifiers actually observed on actionable controls are supported.
    if(role==='button')requireFact(['','disabled','collapsed','expanded'].includes(flags),'AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='checkbox')requireFact(['','settable, integer'].includes(flags),'AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='search text field')requireFact(flags==='settable','AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='checkbox'&&name===EXISTING_CONSENT_LABEL)requireFact(flags==='settable, integer','AX_CONSENT_NOT_SETTABLE');
    nodes.push({index,role,flags,name,value,depth:m[1].length,body:m[5]??''});
  }
  one(nodes,n=>n.role==='AXWebArea'&&n.name===ROOT,'ACTUAL_AX_ROOT_MISMATCH');
  const consent=nodes.some(n=>n.role==='container'&&n.name==='使用前确认');
  const jobs=nodes.some(n=>n.role==='container'&&n.name==='公司职位列表');
  const directory=nodes.some(n=>n.role==='container'&&n.name==='公司目录');
  requireFact(Number(consent)+Number(jobs)+Number(directory)===1,'ACTUAL_AX_UNKNOWN_OR_AMBIGUOUS_VIEW');
  const view=consent?'consent':jobs?'jobs':'directory';
  const deny=/访问被拒绝|拒绝访问|access denied|captcha/i.test(raw);
  const error=/加载失败|请求失败|发生错误|无法加载|网络异常|服务不可用/.test(raw);
  const materialChange=/(新|更新|变更|修订).{0,12}(条款|协议)|(条款|协议).{0,12}(更新|变更|修订)/.test(raw);
  const loading=nodes.some(n=>n.role==='text'&&['正在加载官方职位…','正在加载公司目录…'].includes(n.name));
  let recognized=true;
  if(consent) {
    requireExistingConsentSurface(nodes);
    const checkbox=one(nodes,n=>n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL,'ACTUAL_AX_EXISTING_CONSENT_UNRECOGNIZED');
    requireFact(['0','1'].includes(checkbox.value),'ACTUAL_AX_CHECKBOX_UNKNOWN');
    one(nodes,n=>n.role==='button'&&n.name==='进入 Job-search','ACTUAL_AX_ENTRY_UNRECOGNIZED');
    for(const [name,path] of [['隐私政策','privacy'],['服务条款','terms']]) {
      const link=one(nodes,n=>n.role==='link'&&n.name===name,'ACTUAL_AX_LEGAL_LINK_UNRECOGNIZED');
      recognized &&= [`job.orz.md/${path}`,`https://job.orz.md/${path}`].includes(link.value);
    }
  } else {
    one(nodes,n=>n.role==='button'&&n.name==='官方招聘目录','ACTUAL_AX_NAV_UNRECOGNIZED');
    if(jobs)one(nodes,n=>n.role==='search text field'&&n.name==='职位关键词','ACTUAL_AX_JOBS_UNRECOGNIZED');
    if(directory)one(nodes,n=>n.role==='search text field'&&n.name==='搜索已覆盖公司','ACTUAL_AX_DIRECTORY_UNRECOGNIZED');
  }
  const company=nodes.filter(n=>n.role==='button'&&/^E5\s+武田中国\s+\d+\s+个职位$/.test(n.name));
  requireFact(company.length<=1,'AX_COMPANY_NOT_UNIQUE');
  if(jobs&&!loading)requireFact(company.length===1,'ACTUAL_AX_TARGET_COMPANY_MISSING');
  if(company.length)requireFact(['collapsed','expanded'].includes(company[0].flags),'ACTUAL_AX_EXPANSION_UNKNOWN');
  const expanded=jobs&&company.length===1&&company[0].flags==='expanded';
  const allVisible=expanded&&nodes.some(n=>n.role==='container'&&n.name==='jobs-company-takeda-china')
    &&!nodes.some(n=>n.role==='button'&&/^查看全部 \d+ 个职位$/.test(n.name));
  const search=nodes.find(n=>n.role==='search text field'&&n.name==='搜索已覆盖公司');
  const companyRows=nodes.filter(n=>n.role==='container'&&n.name.startsWith('row-company-'));
  const filtered=directory&&search?.value==='武田'&&companyRows.length===1&&companyRows[0].name==='row-company-takeda-china';
  const controls=[];
  for(const n of nodes)if(['button','checkbox','link','search text field'].includes(n.role)) {
    if(n.role==='checkbox')requireFact(['0','1'].includes(n.value),'ACTUAL_AX_CHECKBOX_UNKNOWN');
    controls.push({index:n.index,role:n.role==='search text field'?'searchbox':n.role,name:n.name,
      disabled:n.flags.split(',').map(s=>s.trim()).includes('disabled'),
      checked:n.role==='checkbox'?n.value==='1':null,value:n.value});
  }
  return {websiteUrl:TARGET.websiteUrl,view,state:deny?'DENIED':error?'ERROR':loading?'LOADING':'READY',
    errorBanner:error,consentAccepted:!consent,materialChangeNotice:materialChange,
    recognizedExistingFlow:recognized,companyExpanded:expanded,allJobsVisible:allVisible,directoryFiltered:filtered,controls};
}
export function assertActualStartupResult(result) {
  requireFact(result&&result.isError===false&&Array.isArray(result.content)&&result.content.length===1
    &&result.content[0]?.type==='text'&&typeof result.content[0].text==='string','UNKNOWN_CUA_STARTUP_FORMAT');
  const text=result.content[0].text;
  const pos=text.lastIndexOf('\nBrowser tab: ');const state=pos>=0?text.slice(pos+1):text;
  decodeActualAx(state); // Handles the observed first-use documentation prefix, not arbitrary success claims.
}
export const ACTUAL_PUBLIC_UI_DECODER=Object.freeze({kind:'REVIEWED_ACTUAL_AX_DECODER',
  evidence:'2026-10-11 bounded dot-cloud public UI shape sample; still requires parent independent review',
  decodeAx:decodeActualAx,assertStartupResult:assertActualStartupResult});
