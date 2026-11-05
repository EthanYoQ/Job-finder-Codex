// Original rendered-DOM collector, exported for the local Chromium transport.
import {join} from 'node:path';
import {savePrivateDomFailure} from './private-dom-failure.mjs';
export function createSanofiDomRuntime(cua, {failureDirectory=join(process.env.JOBFINDER_STATE_ROOT ?? '/data/job-finder','diagnostics','sanofi')} = {}) {
  const entry = 'https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2';
  let tab, deadline, pageNumber;
  function checkTime() { if (Date.now() >= deadline) throw Error('SANOFI_CN_ORIGINAL_CAPTURE_DEADLINE'); }
  async function failed(error,sourceFetchStage) {
    const cause=error instanceof Error?error:Error('SANOFI_CN_DOM_CAPTURE_FAILED');
    cause.sourceFetchStage=sourceFetchStage;cause.sourcePage=pageNumber;
    try {cause.privateCapture=await savePrivateDomFailure({directory:failureDirectory,filePrefix:`sanofi-page-${pageNumber}`,
      context:{kind:'SANOFI_FAILED_PAGE_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE',sourceFetchStage,pageNumber},
      observe:()=>tab.playwright.evaluate(()=>({url:location.href,title:document.title,readyState:document.readyState,
        viewport:{width:innerWidth,height:innerHeight},html:document.documentElement.outerHTML,
        nextLinks:Array.from(document.querySelectorAll('#search-results a.next')).map(a=>{
          const rect=a.getBoundingClientRect(),style=getComputedStyle(a),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
          return {html:a.outerHTML,display:style.display,visibility:style.visibility,pointerEvents:style.pointerEvents,
            rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},hit:hit?{tag:hit.tagName,id:hit.id,className:hit.className}:null};
        })}))});}
    catch {cause.privateCaptureUnavailable=true;}
    throw cause;
  }
  async function start(overallDeadline) {
    pageNumber = 1;
    deadline = Math.min(Date.now() + 20 * 60 * 1000, overallDeadline ?? Infinity);
    checkTime();
    tab = await cua.createBrowserTab('cdp', entry);
    return { deadline };
  }
  async function readPage() {
    checkTime();
    try {
    const root = tab.playwright.locator('#search-results[data-current-page="' + pageNumber + '"]');
    const until = Math.min(deadline, Date.now() + 60000);
    let ready = false;
    while (Date.now() < until) {
      try {
        await root.waitFor({ state: 'visible', timeoutMs: Math.max(1, Math.min(10000, until - Date.now())) });
        ready = true; break;
      } catch (error) {
        if (error?.name !== 'TimeoutError' && !/Timed out waiting for load|Runtime.evaluate timed out|locator.waitFor\(visible\) timed out/.test(String(error))) throw error;
      }
    }
    if (!ready) throw Error('SANOFI_CN_DOM_LOADING_TIMEOUT');
    const captured = await root.evaluate(e => {
      const next = e.querySelector('a.next');
      return { searchResultsHtml: e.outerHTML, nextDisabled: next ? next.classList.contains('disabled') : null };
    });
    if (captured.nextDisabled === null) throw Error('SANOFI_CN_DOM_NEXT_CONTROL_MISSING');
    const page = { url: await tab.url(), capturedAt: new Date().toISOString(), searchResultsHtml: captured.searchResultsHtml };
    checkTime();
    return { page, nextDisabled: captured.nextDisabled };
    } catch(error) {return failed(error,'SANOFI_PAGE_READ');}
  }
  async function advance() {
    checkTime();
    try {
    const rejectOptionalCookies=tab.playwright.locator('#onetrust-reject-all-handler');
    if(await rejectOptionalCookies.isVisible())await rejectOptionalCookies.click();
    await tab.playwright.locator('#search-results a.next').click();
    return { pageNumber: ++pageNumber };
    } catch(error) {return failed(error,'SANOFI_PAGE_NEXT');}
  }
  async function close() { if (tab) await tab.close(); }
  return { start, readPage, advance, close };
}
