import {ACTUAL_PUBLIC_UI_DECODER} from './actual-ax.mjs';
import { TARGET, ACTIONS, EXISTING_CONSENT_LABEL, VerificationHold, BrowserProtocolTimeout,
  exactKeys, requireFact, validateJob, validateExpected } from './contract.mjs';

const TAB = '__jobfinder_viatris_public_ui_v1_tab';
const PREFIX = 'JOBFINDER_VIATRIS_PUBLIC_UI_V1';
const packet = (action, expression) => `nodeRepl.write(JSON.stringify({kind:${JSON.stringify(PREFIX)},action:${JSON.stringify(action)},payload:${expression}}));`;
const fixedScripts = Object.freeze({
  OPEN_HOME: `var ${TAB} = await cua.createBrowserTab("cdp", "https://job.orz.md");`,
  OBSERVE_AX: packet('OBSERVE_AX', `await ${TAB}.getAXState({emit:false,disableDiffing:true})`),
  OPEN_DIRECTORY: `await ${TAB}.playwright.getByRole('button',{name:'官方招聘目录',exact:true}).click();`,
  FILTER_COMPANY: `await ${TAB}.playwright.getByRole('searchbox',{name:'搜索已覆盖公司'}).fill('晖致');`,
  RELOAD: `await ${TAB}.reload();`,
  READ_LIST: packet('READ_LIST', `await ${TAB}.playwright.evaluate(() => {
    const visible = e => {
      if (!e || !e.getClientRects().length) return false;
      for (let n = e; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (n.hidden || n.inert || n.getAttribute('aria-hidden') === 'true'
          || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false;
      }
      return true;
    };
    return {
      companyPresent: visible(document.getElementById('row-company-viatris')),
      jobs: Array.from(document.querySelectorAll('#jobs-company-viatris .job')).filter(visible).map(e => {
        const anchors = e.querySelectorAll('a'), titles = e.querySelectorAll('p.en');
        return { officialUrl: anchors.length === 1 && visible(anchors[0]) ? anchors[0].href : null,
          renderedOriginalTitle: titles.length === 1 && visible(titles[0]) ? titles[0].innerText : null };
      })
    };
  })`),
  READ_SOURCE_TIME: packet('READ_SOURCE_TIME', `await ${TAB}.playwright.evaluate(() => {
    const visible = e => {
      if (!e || !e.getClientRects().length) return false;
      for (let n = e; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (n.hidden || n.inert || n.getAttribute('aria-hidden') === 'true'
          || s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || s.opacity === '0') return false;
      }
      return true;
    };
    const e = document.getElementById('row-company-viatris');
    if (!visible(e)) return null;
    const anchors = e.querySelectorAll('a');
    return anchors.length === 1 && visible(anchors[0]) ? {text:e.innerText, officialEntry:anchors[0].href} : null;
  })`),
});

/** Closed tool-call builder. No arbitrary JS, URL, selectors, source, or tab symbol parameter. */
export function buildCuaCall(operation, { index = null, timeoutMs = 15_000 } = {}) {
  requireFact(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15_000, 'INVALID_CUA_TIMEOUT');
  let code = fixedScripts[operation];
  if (operation === 'CLICK_FRESH_INDEX') {
    requireFact(Number.isSafeInteger(index) && index >= 0 && index <= 1_000_000, 'INVALID_AX_INDEX');
    code = `await ${TAB}.click(${index});`;
  } else requireFact(index === null, 'UNEXPECTED_AX_INDEX');
  requireFact(typeof code === 'string', 'CUA_OPERATION_NOT_ALLOWED');
  // Initialization must remain exactly its one supported CUA entry call.
  if (!['OPEN_HOME','OBSERVE_AX','READ_LIST','READ_SOURCE_TIME'].includes(operation))
    code += '\n' + packet(operation, '{completed:true}');
  return Object.freeze({ code, timeout_ms: timeoutMs, title: 'Verify the approved public JobFinder UI' });
}

/** Parse only the envelope emitted by our fixed nodeRepl.write call.
 * Exact one JSON text block is deliberately conservative. Unknown actual wrappers HOLD.
 */
export function parseCuaPacket(result, action) {
  requireFact(result && typeof result === 'object' && result.isError !== true, 'CUA_TOOL_ERROR_OR_DENIAL');
  requireFact(Array.isArray(result.content) && result.content.length === 1
    && result.content[0]?.type === 'text' && typeof result.content[0].text === 'string', 'UNKNOWN_CUA_RESULT_FORMAT');
  const text = result.content[0].text;
  requireFact(text.length <= 4_000_000, 'CUA_RESULT_TOO_LARGE');
  let data;
  try { data = JSON.parse(text); } catch { throw new VerificationHold('UNKNOWN_CUA_RESULT_FORMAT'); }
  exactKeys(data, ['kind','action','payload'], 'UNKNOWN_CUA_PACKET_FIELDS');
  requireFact(data.kind === PREFIX && data.action === action, 'CUA_PACKET_ACTION_MISMATCH');
  return data.payload;
}

/** Internal normalized snapshot, NOT a claim about the proprietary getAXState return shape. */
export function validateDecodedAx(s) {
  exactKeys(s, ['websiteUrl','view','state','errorBanner','consentAccepted','materialChangeNotice',
    'recognizedExistingFlow','companyExpanded','allJobsVisible','directoryFiltered','controls'], 'UNKNOWN_AX_DECODER_SCHEMA');
  requireFact(s.websiteUrl === TARGET.websiteUrl, 'AX_WRONG_WEBSITE');
  requireFact(['jobs','directory','consent'].includes(s.view)
    && ['READY','LOADING','ERROR','DENIED'].includes(s.state), 'AX_UNKNOWN_VISIBLE_STATE');
  for (const key of ['errorBanner','consentAccepted','materialChangeNotice','recognizedExistingFlow',
    'companyExpanded','allJobsVisible','directoryFiltered']) requireFact(typeof s[key] === 'boolean', 'AX_UNKNOWN_VISIBLE_STATE');
  requireFact(Array.isArray(s.controls) && s.controls.length <= 2000, 'AX_INVALID_CONTROLS');
  const indices = new Set();
  for (const c of s.controls) {
    exactKeys(c, ['index','role','name','disabled','checked','value'], 'AX_UNKNOWN_CONTROL_FIELDS');
    requireFact(Number.isSafeInteger(c.index) && c.index >= 0 && c.index <= 1_000_000 && !indices.has(c.index), 'AX_INVALID_CONTROL_INDEX');
    indices.add(c.index);
    requireFact(['button','checkbox','searchbox','link'].includes(c.role)
      && typeof c.name === 'string' && c.name.length <= 2000 && typeof c.disabled === 'boolean'
      && (c.checked === null || typeof c.checked === 'boolean')
      && (c.value === null || (typeof c.value === 'string' && c.value.length <= 2000)), 'AX_INVALID_CONTROL');
  }
  return s;
}
function unique(s, predicate, code) {
  const matches = s.controls.filter(predicate); requireFact(matches.length === 1, code); return matches[0];
}
function companyControl(s) {
  return unique(s, c => c.role === 'button' && /^B6\s+晖致中国\s+\d+\s+个职位$/.test(c.name), 'AX_COMPANY_NOT_UNIQUE');
}
function companyCount(s) {
  const present=s.controls.filter(c=>c.role==='button'&&/^B6\s+晖致中国\s+\d+\s+个职位$/.test(c.name));
  requireFact(present.length===1,'VIATRIS_COMPANY_MISSING_OR_AMBIGUOUS');
  const c = present[0], n = Number(c.name.match(/晖致中国\s+(\d+)\s+个职位$/)[1]);
  requireFact(Number.isSafeInteger(n) && n > 0 && n <= 1000, 'AX_COMPANY_COUNT_INVALID'); return n;
}
function assertConsent(s) {
  requireFact(s.recognizedExistingFlow && !s.materialChangeNotice, 'CONSENT_CHANGED_OR_UNVERIFIED');
  if (s.view === 'consent') {
    unique(s, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    for (const [name, path] of [['隐私政策','privacy'],['服务条款','terms']]) {
      const c = unique(s, c => c.role === 'link' && c.name === name, 'AX_LEGAL_LINK_NOT_UNIQUE');
      requireFact([`job.orz.md/${path}`,`https://job.orz.md/${path}`].includes(c.value), 'CONSENT_CHANGED_OR_UNVERIFIED');
    }
    requireFact(!s.consentAccepted, 'AX_CONSENT_STATE_CONFLICT');
  } else requireFact(s.consentAccepted, 'AX_CONSENT_NOT_ACCEPTED');
}
export function resolveFreshControl(snapshot, action) {
  validateDecodedAx(snapshot); assertConsent(snapshot);
  requireFact(snapshot.state === 'READY' && !snapshot.errorBanner, 'AX_UI_NOT_READY');
  let c;
  if (action === 'CHECK_EXISTING_CONSENT') {
    requireFact(snapshot.view === 'consent', 'AX_CONSENT_VIEW_REQUIRED');
    c = unique(snapshot, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    requireFact(c.checked === false, 'AX_CONSENT_CHECK_ALREADY_SET');
  } else if (action === 'ENTER_EXISTING_CONSENT') {
    requireFact(snapshot.view === 'consent', 'AX_CONSENT_VIEW_REQUIRED');
    const check = unique(snapshot, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    requireFact(check.checked === true, 'AX_CONSENT_NOT_CHECKED');
    c = unique(snapshot, c => c.role === 'button' && c.name === '进入 Job-search', 'AX_ENTRY_NOT_UNIQUE');
  } else if (action === 'EXPAND_COMPANY') {
    requireFact(snapshot.view === 'jobs' && !snapshot.companyExpanded, 'AX_COMPANY_EXPANSION_STATE');
    c = companyControl(snapshot);
  } else if (action === 'VIEW_ALL') {
    requireFact(snapshot.view === 'jobs' && snapshot.companyExpanded && !snapshot.allJobsVisible, 'AX_VIEW_ALL_STATE');
    const count = companyCount(snapshot);
    c = unique(snapshot, c => c.role === 'button' && c.name === `查看全部 ${count} 个职位`, 'AX_VIEW_ALL_NOT_UNIQUE');
  } else if (action === 'OPEN_DIRECTORY') {
    c = unique(snapshot, c => c.role === 'button' && c.name === '官方招聘目录', 'AX_DIRECTORY_NOT_UNIQUE');
  } else if (action === 'FILTER_COMPANY') {
    requireFact(snapshot.view === 'directory', 'AX_DIRECTORY_VIEW_REQUIRED');
    c = unique(snapshot, c => c.role === 'searchbox' && c.name === '搜索已覆盖公司', 'AX_SEARCHBOX_NOT_UNIQUE');
  } else throw new VerificationHold('AX_ACTION_NOT_ALLOWED');
  requireFact(!c.disabled, 'AX_CONTROL_DISABLED'); return c.index;
}

// The fixed host checks the original committed receipt and every full persisted
// projection hash before this call. Public DOM carries no native positionId.
// Freeze one exact, one-to-one href -> original positionId join. No URL parsing.
const expectedSignature = e => JSON.stringify([e.batchId,e.sourceId,e.companyId,e.observedAt,
  e.expectedFileSha256,e.jobs.map(j=>[j.sourceJobId,j.officialTitle,j.officialUrl]),e.removedIds]);
function bindExpectedPublicIds(expected) {
  validateExpected(expected);
  const snapshot=JSON.parse(JSON.stringify(expected)),idsByUrl=Object.create(null);
  for(const job of snapshot.jobs){requireFact(!Object.hasOwn(idsByUrl,job.officialUrl),'VIATRIS_AMBIGUOUS_EXPECTED_URL');idsByUrl[job.officialUrl]=job.sourceJobId;Object.freeze(job);}
  Object.freeze(snapshot.jobs);Object.freeze(snapshot.removedIds);Object.freeze(snapshot);
  return Object.freeze({expected:snapshot,signature:expectedSignature(snapshot),idsByUrl:Object.freeze(idsByUrl)});
}
export function mergeRenderedList(payload, expected) {
  return mergeReviewedRenderedList(payload,bindExpectedPublicIds(expected));
}
function mergeReviewedRenderedList(payload, binding) {
  const originalId=url=>{requireFact(Object.hasOwn(binding.idsByUrl,url),'VIATRIS_UNREVIEWED_PUBLIC_URL');return binding.idsByUrl[url];};
  exactKeys(payload, ['companyPresent','jobs'], 'INVALID_RENDERED_COLLECTION_FIELDS');
  requireFact(payload.companyPresent === true,'VIATRIS_RENDERED_COMPANY_MISSING');
  requireFact(Array.isArray(payload.jobs) && payload.jobs.length > 0
    && payload.jobs.length <= 1000, 'VIATRIS_RENDERED_LIST_EMPTY_OR_INVALID');
  const seen = new Set();
  return payload.jobs.map(raw => {
    exactKeys(raw,['officialUrl','renderedOriginalTitle'],'INVALID_RENDERED_JOB_FIELDS');
    requireFact(typeof raw.officialUrl === 'string', 'INVALID_RENDERED_JOB_URL');
    const sourceJobId=originalId(raw.officialUrl);
    requireFact(!seen.has(raw.officialUrl), 'DUPLICATE_RENDERED_URL'); seen.add(raw.officialUrl);
    const job={sourceJobId,officialTitle:raw.renderedOriginalTitle,officialUrl:raw.officialUrl,
      renderedOriginalTitle:raw.renderedOriginalTitle};
    validateJob(job,true); return job;
  });
}
export function parseVisibleSourceCard(payload) {
  requireFact(payload !== null, 'SOURCE_TIME_MISSING'); exactKeys(payload, ['text','officialEntry'], 'INVALID_SOURCE_CARD_FIELDS');
  requireFact(typeof payload.text === 'string' && payload.text.length <= 4096
    && payload.officialEntry === TARGET.officialEntry, 'WRONG_TIME_SOURCE');
  requireFact(payload.text.split(/\r?\n/).map(s => s.trim()).includes(TARGET.companyName), 'WRONG_TIME_SOURCE');
  const matches = [...payload.text.matchAll(/^[ \t]*最近成功更新[ \t]+(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)[ \t\r]*$/gm)];
  requireFact(matches.length === 1, 'HOLD_TIME_UNKNOWN');
  return { companyId: TARGET.companyId, companyName: TARGET.companyName, officialEntry: TARGET.officialEntry,
    label: '最近成功更新', text: matches[0][1], precision: 'minute', timezone: 'UTC', timezoneEvidence: 'VISIBLE_UTC_LABEL' };
}
function observation(action, s, jobs = null, sourceTime = null) {
  validateDecodedAx(s); assertConsent(s);
  const checkbox = s.view === 'consent' ? unique(s, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE') : null;
  const entry = s.view === 'consent' ? unique(s, c => c.role === 'button' && c.name === '进入 Job-search', 'AX_ENTRY_NOT_UNIQUE') : null;
  const count = s.view === 'jobs' && s.state === 'READY' ? companyCount(s) : null;
  return { schemaVersion: 1, action, observedAt: new Date().toISOString(), websiteUrl: s.websiteUrl,
    sourceId: TARGET.sourceId, companyId: TARGET.companyId, companyName: TARGET.companyName,
    view: s.view, state: s.state, errorBanner: s.errorBanner,
    consent: {state:s.consentAccepted?'ACCEPTED':'EXISTING_REQUIRED',recognizedExistingFlow:s.recognizedExistingFlow,
      materialChangeNotice:s.materialChangeNotice,checkboxLabel:checkbox?.name??null,
      checkboxChecked:checkbox?.checked??false,entryEnabled:entry?!entry.disabled:false},
    ui:{companyExpanded:s.companyExpanded,viewAllVisible:s.view==='jobs' && s.companyExpanded && !s.allJobsVisible,
      allJobsVisible:s.allJobsVisible,displayedCount:count,directoryFiltered:s.directoryFiltered},jobs,sourceTime };
}

export const UNBOUND_AX_DECODER = Object.freeze({kind:'UNBOUND_ACTUAL_AX_AND_STARTUP_FORMAT'});
/** No tool module import. The actual hosted tool is injected only after separate review.
 * The default actual decoder uses the separately sampled grammar. Real tool execution stays disabled.
 */
export function createCuaBrowserPort({enabled=false,toolCall=null,decoder=ACTUAL_PUBLIC_UI_DECODER,expected=null}={}) {
  // Snapshot only validated public data, so later caller mutation cannot retarget the join.
  const fixedBinding=enabled===true?bindExpectedPublicIds(expected):null;

  let opened=false, serial=0, lastUsedSerial=0, reloads=0, busy=false, halted=false;
  let originalToolOperation=null,toolOperationPending=false;
  const toolReceipts=[];
  const configured=enabled===true && typeof toolCall==='function'
    && decoder?.kind==='REVIEWED_ACTUAL_AX_DECODER' && typeof decoder.decodeAx==='function'
    && typeof decoder.assertStartupResult==='function';
  return Object.freeze({enabled:configured,kind:configured?'REVIEWED_PUBLIC_UI':'UNBOUND',targetKey:TARGET.key,
    bindingStatus:configured?'REQUIRES_INDEPENDENT_LIVE_QUALIFICATION':'REAL_CUA_TOOL_DISABLED',
    get originalToolOperation(){return originalToolOperation;},
    get toolOperationPending(){return toolOperationPending;},
    get toolReceipts(){return JSON.parse(JSON.stringify(toolReceipts));},
    assertExpected(value){validateExpected(value);requireFact(fixedBinding!==null
      && expectedSignature(value)===fixedBinding.signature,'VIATRIS_PORT_EXPECTED_BINDING_MISMATCH');},
    invalidateForTimeout(){halted=true;},
    async execute(request) {
      requireFact(configured,'CUA_PORT_DISABLED');
      requireFact(!halted && !busy,'CUA_PORT_HALTED_OR_BUSY'); busy=true;
      try {
      exactKeys(request,['schemaVersion','action','target','timeoutMs','deadlineAtMs'],'INVALID_CUA_REQUEST');
      requireFact(request.schemaVersion===1 && ACTIONS.includes(request.action)
        && JSON.stringify(request.target)===JSON.stringify(TARGET),'CUA_REQUEST_TARGET_NOT_ALLOWED');
      requireFact(Number.isSafeInteger(request.timeoutMs)&&request.timeoutMs>0&&request.timeoutMs<=15000,'INVALID_CUA_TIMEOUT');
      requireFact(Number.isSafeInteger(request.deadlineAtMs),'INVALID_CUA_ABSOLUTE_DEADLINE');
      const action=request.action, deadline=request.deadlineAtMs;
      async function call(operation,index=null) {
        const remaining=Math.floor(deadline-Date.now()); if(halted||remaining<=0||remaining>request.timeoutMs)throw new BrowserProtocolTimeout();
        requireFact(toolReceipts.length<160,'CUA_TOOL_CALL_BUDGET_EXHAUSTED');
        const receipt={sequence:toolReceipts.length+1,operation,startedAt:new Date().toISOString(),finishedAt:null,outcome:'PENDING'};
        toolReceipts.push(receipt);
        let response;
        try {
          originalToolOperation=toolCall(buildCuaCall(operation,{index,timeoutMs:Math.min(remaining,15000)}));
          requireFact(originalToolOperation && typeof originalToolOperation.then==='function','CUA_TOOL_DID_NOT_RETURN_PROMISE');
          toolOperationPending=true;response=await originalToolOperation;receipt.outcome='SETTLED';
        }
        catch(error){receipt.outcome=error instanceof BrowserProtocolTimeout?'TIMEOUT_UNKNOWN':'ERROR';throw error;}
        finally {toolOperationPending=false;receipt.finishedAt=new Date().toISOString();}
        if(halted||Date.now()>=deadline)throw new BrowserProtocolTimeout();
        return response;
      }
      async function fresh() {
        const raw=parseCuaPacket(await call('OBSERVE_AX'),'OBSERVE_AX');
        const s=decoder.decodeAx(raw); validateDecodedAx(s); serial++;
        requireFact(s.state!=='DENIED','EXPLICIT_DENIAL'); requireFact(s.state!=='ERROR'&&!s.errorBanner,'ERROR_BANNER');
        assertConsent(s); return s;
      }
      let snapshot;
      if(action==='OPEN_HOME') {
        requireFact(!opened,'CUA_ALREADY_OPENED'); opened=true;
        // The first call contains exactly createBrowserTab. Its actual native result
        // must be recognized by the reviewed decoder, not an invented success packet.
        decoder.assertStartupResult(await call('OPEN_HOME'));
        snapshot=await fresh();
      } else {
        requireFact(opened,'CUA_HOME_NOT_OPENED');
        if(action==='WAIT_VISIBLE') snapshot=await fresh();
        else if(action==='READ_LIST'||action==='READ_SOURCE_TIME') {
          snapshot=await fresh();
          if(action==='READ_LIST')requireFact(snapshot.state==='READY'&&snapshot.view==='jobs'&&companyCount(snapshot)>0&&snapshot.companyExpanded&&snapshot.allJobsVisible,'LIST_NOT_READY');
          else requireFact(snapshot.state==='READY'&&snapshot.view==='directory'&&snapshot.directoryFiltered,'SOURCE_TIME_NOT_READY');
          const payload=parseCuaPacket(await call(action),action);
          const jobs=action==='READ_LIST'?mergeReviewedRenderedList(payload,fixedBinding):null;
          const sourceTime=action==='READ_SOURCE_TIME'?parseVisibleSourceCard(payload):null;
          const after=await fresh();
          requireFact(after.state==='READY'&&after.view===snapshot.view,'AX_CHANGED_DURING_PUBLIC_READ');
          if(action==='READ_LIST')requireFact(companyCount(after)===companyCount(snapshot)&&after.companyExpanded&&after.allJobsVisible,'AX_CHANGED_DURING_PUBLIC_READ');
          else requireFact(after.directoryFiltered,'AX_CHANGED_DURING_PUBLIC_READ');
          return observation(action,after,jobs,sourceTime);
        } else if(action==='RELOAD') {
          requireFact(reloads++ === 0,'RELOAD_BUDGET_EXHAUSTED');
          const payload=parseCuaPacket(await call('RELOAD'),'RELOAD'); exactKeys(payload,['completed'],'CUA_ACTION_NOT_CONFIRMED');
          requireFact(payload.completed===true,'CUA_ACTION_NOT_CONFIRMED');snapshot=await fresh();
        } else {
          snapshot=await fresh();const index=resolveFreshControl(snapshot,action);
          requireFact(serial>lastUsedSerial,'STALE_AX_INDEX');lastUsedSerial=serial;
          const operation=['OPEN_DIRECTORY','FILTER_COMPANY'].includes(action)?action:'CLICK_FRESH_INDEX';
          const payload=parseCuaPacket(await call(operation,operation==='CLICK_FRESH_INDEX'?index:null),operation);
          exactKeys(payload,['completed'],'CUA_ACTION_NOT_CONFIRMED');requireFact(payload.completed===true,'CUA_ACTION_NOT_CONFIRMED');
          snapshot=await fresh();
        }
      }
      return observation(action,snapshot);
      } catch(error) { halted=true; throw error; } finally { busy=false; }
    }
  });
}
