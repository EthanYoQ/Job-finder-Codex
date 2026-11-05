// Reuse the original 30s budget when a selector wait reports timeout early.
async function waitOriginalDomVisible(locator, deadline) {
  const until=Math.min(deadline,Date.now()+30000);
  let waitError;
  for(;;) {
    const remaining=until-Date.now();
    if(remaining<=0)throw waitError??Error('ORIGINAL_DOM_VISIBLE_WAIT_DEADLINE');
    try {
      await locator.waitFor({state:'visible',timeoutMs:remaining});
      if(Date.now()>=until)throw Error('ORIGINAL_DOM_VISIBLE_WAIT_DEADLINE');
      return;
    } catch(error) {
      if(!/selector deadline exceeded|locator\.waitFor\(visible\) timed out/.test(String(error))||Date.now()>=until)throw error;
      waitError=error;
    }
  }
}
import {join} from 'node:path';
import {savePrivateDomFailure} from './private-dom-failure.mjs';
import {parseOfficialRetryAfter,retryableHttpTransportFailure} from '../sourceFetchFailure.ts';

function httpAccessFailure(navigation) {
  if(!navigation)return;
  if(navigation.httpStatus===429) {
    const retryAfter=parseOfficialRetryAfter(navigation.retryAfter ?? null,Date.now());
    return Object.assign(Error('JNJ_HTTP_429'),{transportFailure:retryableHttpTransportFailure(429,retryAfter) ??
      {code:'OFFICIAL_HTTP_429',retryable:true}});
  }
  if(navigation.httpStatus===403)return Object.assign(Error('JNJ_HTTP_403'),{
    transportFailure:{code:'OFFICIAL_BROWSER_SESSION_ERROR',retryable:true}});
}
async function rejectTemporaryAccessFailure(tab,selector) {
  const navigation=await tab.navigationInfo?.();
  if(!navigation)return;
  const failure=httpAccessFailure(navigation);
  if(failure)throw failure;
  const challenge=await tab.playwright.evaluate(normalSelector=>
    !document.querySelector(normalSelector) && document.title.trim()==='Just a moment...' &&
    Array.from(document.scripts).some(script=>script.src.includes('/cdn-cgi/challenge-platform/') ||
      script.textContent.includes('window._cf_chl_opt')),selector);
  if(challenge)throw Object.assign(Error('JNJ_BROWSER_CHALLENGE'),{
    transportFailure:{code:'OFFICIAL_BROWSER_SESSION_ERROR',retryable:true}});
}

async function saveDetailFailure(tab, context, directory) {
  return savePrivateDomFailure({directory,filePrefix:`jnj-detail-${context.sourceJobId}`,
    context:{kind:'JNJ_FAILED_DETAIL_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE',...context},
    observe:()=>{if(context.readinessDeadlineExceeded)throw Error('JNJ_DETAIL_READY_DEADLINE');
      return tab.playwright.evaluate(() => ({url:location.href, title:document.title, readyState:document.readyState,
        detailCount:document.querySelectorAll('#js-job-detail').length,
        applyLinks:Array.from(document.querySelectorAll('a')).filter(a=>a.textContent.trim()==='Apply now')
          .map(a=>({text:a.textContent.trim(),href:a.href})),
        html:document.documentElement.outerHTML}));}});
}
// Original JNJ DOM collector using the local Chromium tab transport.
export function createJnjDomRuntime(cua, {failureDirectory=join(process.env.JOBFINDER_STATE_ROOT ?? '/data/job-finder','diagnostics','jnj')} = {}) {
  const origin = 'https://www.careers.jnj.com';
  const listUrl = page => origin+'/en/jobs/?'+(page===1?'':'page='+page+'&')+'country=China&origin=global#results';
  let list, detail, deadline, total, current = [], page = 1;
  const seen = new Set();
  const checkTime = () => { if (Date.now() >= deadline) throw Error('JNJ_ORIGINAL_30_MINUTE_CAPTURE_DEADLINE'); };
  const raw = value => JSON.stringify(value,null,2)+'\n';
  async function start(overallDeadline) {
    const startedAt = new Date().toISOString();
    deadline = Math.min(Date.parse(startedAt)+30*60*1000,overallDeadline ?? Infinity);
    checkTime();
    list = await cua.createBrowserTab('cdp');
    try { await list.goto(listUrl(1)); }
    catch(error) {
      const navigation=await list.navigationInfo?.();
      const cause=httpAccessFailure(navigation)??(error instanceof Error?error:Error('JNJ_LIST_NAVIGATION_FAILED'));
      cause.sourceFetchStage='JNJ_LIST_NAVIGATION';cause.sourcePage=1;
      try {cause.privateCapture=await savePrivateDomFailure({directory:failureDirectory,filePrefix:'jnj-list-1',
        context:{kind:'JNJ_FAILED_LIST_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE',sourceFetchStage:cause.sourceFetchStage,page:1,
          errorMessage:error instanceof Error?error.message:String(error),url:await list.url(),navigation},
        observe:()=>list.playwright.evaluate(()=>({url:location.href,title:document.title,readyState:document.readyState,
          navigationStatus:performance.getEntriesByType('navigation')[0]?.responseStatus??null,html:document.documentElement.outerHTML}))});}
      catch {cause.privateCaptureUnavailable=true;}
      throw cause;
    }
    detail = await cua.createBrowserTab('cdp');
    return {startedAt,deadline};
  }
  async function readList() {
    checkTime();
    let headingLocator;
    let sourceFetchStage = 'JNJ_RESULTS_READY';
    try {
      await rejectTemporaryAccessFailure(list,'#js-job-search-results');
      await list.playwright.locator('#js-job-search-results').waitFor({state:'visible',timeoutMs:30000});
      headingLocator = list.playwright.getByRole('heading',{name:total===undefined?/^Displaying 1 to \d+ of \d+ matching jobs$/:`Displaying ${(page-1)*20+1} to ${Math.min(page*20,total)} of ${total} matching jobs`,exact:true});
      sourceFetchStage = 'JNJ_HEADING_READY';
      await waitOriginalDomVisible(headingLocator,deadline);
    } catch(error) {
      const value={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',page,expectedUrl:listUrl(page),error:String(error),observedAt:new Date().toISOString()};
      try { value.url=await list.url(); } catch(readError) { value.urlReadError=String(readError); }
      const cause = error instanceof Error ? error : Error('JNJ_DOM_READINESS_FAILED');
      cause.sourceFetchStage = sourceFetchStage;
      cause.sourcePage = page;
      try {cause.privateCapture=await savePrivateDomFailure({directory:failureDirectory,filePrefix:`jnj-list-${page}`,
        context:{kind:'JNJ_FAILED_LIST_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE',sourceFetchStage,page,total,
          collectedCards:current.length,legacyObservation:value},
        observe:()=>list.playwright.evaluate(()=>({url:location.href,title:document.title,readyState:document.readyState,
          navigationStatus:performance.getEntriesByType('navigation')[0]?.responseStatus ?? null,
          resultCount:document.querySelectorAll('#js-job-search-results').length,
          headings:Array.from(document.querySelectorAll('h1,h2,h3')).map(e=>e.textContent),
          html:document.documentElement.outerHTML}))});}
      catch {cause.privateCaptureUnavailable=true;}
      return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:value.error,error:cause};
    }
    const heading = await headingLocator.innerText();
    const fragment = await list.playwright.locator('#js-job-search-results').evaluate(e=>({html:e.outerHTML,htmlLength:e.outerHTML.length,
      items:Array.from(e.children).map(e=>({text:e.innerText,links:Array.from(e.querySelectorAll('a[href*="/jobs/r-"]')).map(a=>({title:a.textContent.trim(),url:a.href}))}))}));
    const value = {kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:await list.url(),heading,fragment,
      filters:await list.playwright.locator('select[name]').evaluateAll(es=>es.map(e=>({id:e.id,name:e.name,selectedOptions:Array.from(e.selectedOptions).map(o=>({text:o.text,value:o.value}))}))),
      pagination:await list.playwright.getByRole('link',{name:/^(?:Page \d+|Next page|Previous page)$/}).evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),text:e.textContent.trim(),url:e.href}))),
      dom:await list.playwright.domSnapshot(),observedAt:new Date().toISOString()};
    const declaration = /^Displaying (\d+) to (\d+) of (\d+) matching jobs$/.exec(heading);
    if(!declaration) throw Error('JNJ_DOM_TOTAL_DECLARATION');
    total ??= Number(declaration[3]);
    if(value.url!==listUrl(page) || total<=0 || total>400 || Number(declaration[3])!==total ||
       Number(declaration[1])!==(page-1)*20+1 || Number(declaration[2])!==Math.min(page*20,total) ||
       fragment.items.length!==Math.min(20,total-(page-1)*20)) {
      return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:'JNJ_DOM_PAGE_DRIFT:'+JSON.stringify({page,expectedUrl:listUrl(page),actualUrl:value.url,heading,itemCount:fragment.items.length,total})};
    }
    const names=['team','subteam','country','state','location','type','pattern'];
    if(JSON.stringify(value.filters.map(f=>f.name))!==JSON.stringify(names) || value.filters.some(f=>JSON.stringify(f.selectedOptions)!==JSON.stringify(f.name==='country'?[{text:'China',value:'China'}]:[]))) throw Error('JNJ_DOM_SCOPE');
    for (const [index,item] of fragment.items.entries()) {
      if(item.links.length!==1) throw Error('JNJ_DOM_CARD_IDENTITY');
      const card=item.links[0],url=new URL(card.url),id=/^\/en\/jobs\/(r-\d+)\/[^/?#]+\/$/.exec(url.pathname)?.[1];
      if(!id || url.origin!==origin || url.username || url.password || url.search || url.hash || seen.has(id)) {
        // Preserve this real failed page before the Functions caller holds the source.
        return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:'JNJ_DOM_DUPLICATE_OR_INVALID_ID:'+JSON.stringify({page,index,id:id??null,url:card.url,alreadySeen:seen.has(id)})};
      }
      seen.add(id);current.push({...card,id});
    }
    const next=value.pagination.filter(a=>a.label==='Next page');
    if(next.length!==(page<Math.ceil(total/20)?1:0) || next.length && next[0].url!==listUrl(page+1)) throw Error('JNJ_DOM_PAGINATION');
    checkTime();
    return {file:'jnj-list-page-'+page+'.json',raw:raw(value),rowCount:fragment.items.length,total,next:next.length===1};
  }
  async function readDetail(index) {
    checkTime();
    const card=current?.[index];
    if(!card) throw Error('JNJ_DOM_DETAIL_NOT_IN_CURRENT_PAGE');
    // Sequential requests still caused HTTP 429; leave space between detail pages.
    if(index>0)await new Promise(resolve=>setTimeout(resolve,2000));
    checkTime();
    let sourceFetchStage='JNJ_DETAIL_NAVIGATION', navigationStatus, readinessDeadlineExceeded=false;
    try {
    const response=await detail.goto(card.url);
    if(typeof response?.status==='function')navigationStatus=response.status();
    const readyDeadline=Math.min(deadline,Date.now()+60000);
    for(let attempt=0;attempt<2;attempt++) {
    try {
    sourceFetchStage='JNJ_DETAIL_READY';
    const remaining=readyDeadline-Date.now();
    if(remaining<=0){readinessDeadlineExceeded=true;throw Error('JNJ_DETAIL_READY_DEADLINE');}
    let readinessTimer;
    try {
      await Promise.race([rejectTemporaryAccessFailure(detail,'#js-job-detail'),new Promise((_,reject)=>{
        readinessTimer=setTimeout(()=>{readinessDeadlineExceeded=true;reject(Error('JNJ_DETAIL_READY_DEADLINE'));},remaining);
      })]);
    } finally {clearTimeout(readinessTimer);}
    await detail.playwright.locator('#js-job-detail').waitFor({state:'visible',timeoutMs:Math.max(1,Math.min(30000,readyDeadline-Date.now()))});
    sourceFetchStage='JNJ_APPLY_READY';
    await detail.playwright.getByRole('link',{name:'Apply now',exact:true}).waitFor({state:'visible',timeoutMs:Math.max(1,Math.min(30000,readyDeadline-Date.now()))});
    sourceFetchStage='JNJ_DETAIL_READ';
    const value={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:await detail.url(),expectedUrl:card.url,expectedTitle:card.title,
      heading:await detail.playwright.locator('h1').innerText(),
      body:await detail.playwright.locator('#js-job-detail').evaluate(e=>({html:e.outerHTML,htmlLength:e.outerHTML.length,text:e.innerText})),
      applyLinks:await detail.playwright.getByRole('link',{name:'Apply now',exact:true}).evaluateAll(es=>es.map(e=>({text:e.textContent.trim(),href:e.href}))),
      dom:await detail.playwright.domSnapshot(),observedAt:new Date().toISOString()};
    if(value.url!==card.url || value.heading.replace(/\s+/g,' ').trim()!==card.title.replace(/\s+/g,' ').trim()) throw Error('JNJ_DOM_DETAIL_IDENTITY');
    checkTime();
    return {file:card.id+'.json',raw:raw(value)};
    } catch(error) {
      // A native page navigation can replace the DOM after readiness; reread once without another goto.
      if(attempt!==0||Date.now()>=readyDeadline||!String(error?.message??error).includes('Execution context was destroyed, most likely because of a navigation'))throw error;
    }
    }
    } catch(error) {
      const cause=error instanceof Error?error:Error('JNJ_DETAIL_CAPTURE_FAILED');
      cause.sourceFetchStage=sourceFetchStage;
      cause.sourceJobId=card.id;
      // A timed-out evaluate is still pending. Do not queue browser diagnostics; the caller's finally closes the tab.
      try { cause.privateCapture=await saveDetailFailure(detail,{sourceJobId:card.id,sourceFetchStage,
        detailIndex:index,completedDetails:index,total,navigationStatus,
        navigation:readinessDeadlineExceeded?undefined:await detail.navigationInfo?.(),
        readinessDeadlineExceeded:readinessDeadlineExceeded||undefined,
        expectedUrl:card.url,expectedTitle:card.title},failureDirectory); }
      catch { cause.privateCaptureUnavailable=true; }
      throw cause;
    }
  }
  async function advance() {
    checkTime();
    const nextUrl=await list.playwright.getByRole('link',{name:'Next page',exact:true}).evaluate(e=>e.href);
    if(nextUrl!==listUrl(page+1))throw Error('JNJ_DOM_PAGINATION');
    await list.goto(nextUrl);
    page++;
    return {page};
  }
  async function close() { if(detail) await detail.close(); if(list) await list.close(); }
  return {start,readList,readDetail,advance,close};
}


