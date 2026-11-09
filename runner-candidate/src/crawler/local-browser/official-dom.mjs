import { createChromiumDom } from './chromium-dom.mjs';
import { createCspcDomRuntime } from './cspc-browser-runtime.mjs';
import { createJnjDomRuntime } from './jnj-browser-runtime.mjs';
import { createAbortableClose } from '../officialHttpRuntimeLimits.ts';
import {join} from 'node:path';
import {savePrivateDomFailure} from './private-dom-failure.mjs';

/** Existing source collectors, with a local browser lifetime instead of a tool session. */
export async function captureOfficialDom(sourceId, cua, runStartedAt = new Date().toISOString()) {
  const deadline = Date.parse(runStartedAt) + 30 * 60_000;
  if (sourceId === 'source-cspc-social') {
    const runtime = createCspcDomRuntime(cua);
    let failedCapture,nativeSourceUrl;
    try {
      const { rowCount } = await runtime.start({ runStartedAt, dispatchBefore: new Date(deadline).toISOString() });
      for(let index=0;index<rowCount;index++){try{await runtime.readRow(index);}catch(error){await runtime.isolateRowFailure(index,error);}}
      const result = await runtime.finish(false);
      const provenance = { tool: 'playwright-core-local-chromium', browser: 'chromium', networkCapture: false };
      return { dom: { ...result.dom, ...provenance }, applications: { ...result.applications, ...provenance } };
    } catch(error) {
      const cause=error instanceof Error?error:Error('CSPC_DOM_CAPTURE_FAILED');
      failedCapture=cause;
      cause.sourceFetchStage='CSPC_DOM_CAPTURE';
      try {cause.privateCapture=await savePrivateDomFailure({
        directory:join(process.env.JOBFINDER_STATE_ROOT??'/data/job-finder','diagnostics','cspc'),filePrefix:'cspc-dom',
        context:{kind:'CSPC_FAILED_DOM_DIAGNOSTIC_NOT_PUBLICATION_EVIDENCE'},observe:async()=>{
          const observation=await runtime.failureState();
          nativeSourceUrl=observation.url;
          return observation;
        }});}
      catch {cause.privateCaptureUnavailable=true;}
      throw cause;
    } finally {
      await runtime.close();
      if(failedCapture?.message==='CSPC_DOM_LOADING_TIMEOUT'&&nativeSourceUrl)try{
        // Read Chromium's final in-memory status after all owned tabs close; diagnostic I/O can outlive the earlier snapshot.
        const navigation=await runtime.navigationInfo();
        if(navigation)failedCapture.cspcNativeResponse={sourceUrl:nativeSourceUrl,navigation};
      }catch{ /* Keep the original failure when final browser status is unavailable. */ }
    }
  }
  if (sourceId === 'source-johnson-innovative-medicine-social') {
    const runtime = createJnjDomRuntime(cua), lists = [], details = [];
    try {
      await runtime.start(deadline);
      for (let page = 0; page < 20; page++) {
        const value = await runtime.readList();
        if (value.failure) throw value.error ?? Error(value.failure);
        lists.push(value.raw);
        if (!value.next) {
          for(let index=0;index<value.total;index++){
            let detail;try{detail=await runtime.readDetail(index);}catch(error){detail=await runtime.isolateDetailFailure(index,error);}
            if(detail.raw)details.push(detail.raw);
          }
          return { lists, details };
        }
        await runtime.advance();
      }
      throw Error('JNJ_DOM_PAGE_LIMIT');
    } finally { await runtime.close(); }
  }
  if (sourceId === 'source-boehringer-ingelheim-china-social') {
    const entry = 'https://campus.51job.com/BI/recruitSociety.html';
    const tab = await cua.createBrowserTab('cdp', entry);
    try {
      const links = tab.playwright.locator('a[href*="recruit_article_detail3.html?jobId="]');
      await links.first().waitFor({ state: 'visible', timeoutMs: 30000 });
      const rows = await links.evaluateAll(elements => elements.map(a => ({ href: a.getAttribute('href'), origin: a.origin,
        pathname: a.pathname, search: a.search, cells: Array.from(a.parentElement.children).map(e => e.innerText),
        visible: !!a.getClientRects().length, html: a.parentElement.outerHTML })));
      const dom = { captured_at: new Date().toISOString(), source_url: await tab.url(), rows };
      if (dom.source_url !== entry) throw Error('BI_DOM_SOURCE_IDENTITY');
      dom.jobs = rows.map(row => {
        const jobId = /(?:^\?|&)jobId=([^&]*)/.exec(row.search)?.[1];
        return { jobId, title: row.cells[1], job_number: row.cells[2], location: row.cells[3], published_at: row.cells[4], href: row.href, visible: row.visible };
      });
      if (new Set(dom.jobs.map(row => row.jobId)).size !== dom.jobs.length) throw Error('BI_DOM_DUPLICATE');
      return { dom };
    } finally { await tab.close(); }
  }
  throw Error('OFFICIAL_DOM_SOURCE_UNSUPPORTED');
}

export async function captureLocalOfficialDom(sourceId, runStartedAt, signal) {
  signal?.throwIfAborted();
  const { chromium } = await import('playwright-core');
  signal?.throwIfAborted();
  const cua = await createChromiumDom({ chromium, netLogPath:sourceId==='source-johnson-innovative-medicine-social'?process.env.JOBFINDER_JNJ_NETLOG_FILE:undefined, executablePath: process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium' });
  const cleanup = createAbortableClose(signal, () => cua.close());
  try { signal?.throwIfAborted(); return await captureOfficialDom(sourceId, cua, runStartedAt); }
  finally { cleanup.dispose(); await cleanup.close(); }
}
