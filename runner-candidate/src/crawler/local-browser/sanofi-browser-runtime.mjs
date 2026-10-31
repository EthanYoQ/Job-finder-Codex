// Original rendered-DOM collector, exported for the local Chromium transport.
export function createSanofiDomRuntime(cua) {
  const entry = 'https://jobs.sanofi.cn/%e6%b1%82%e8%81%8c/%E4%B8%AD%E5%9B%BD/2649/2/1814991/35/105/50/2';
  let tab, deadline, pageNumber;
  function checkTime() { if (Date.now() >= deadline) throw Error('SANOFI_CN_ORIGINAL_CAPTURE_DEADLINE'); }
  async function start(overallDeadline) {
    pageNumber = 1;
    deadline = Math.min(Date.now() + 20 * 60 * 1000, overallDeadline ?? Infinity);
    checkTime();
    tab = await cua.createBrowserTab('cdp', entry);
    try { await tab.getAXState({ emit: false }); return { deadline }; }
    catch (error) { await tab.close(); throw error; }
  }
  async function readPage() {
    checkTime();
    const root = tab.playwright.locator('#search-results[data-current-page="' + pageNumber + '"]');
    const until = Math.min(deadline, Date.now() + 60000);
    let ready = false;
    while (Date.now() < until) {
      try {
        await tab.playwright.waitForLoadState({ state: 'load', timeoutMs: Math.min(10000, until - Date.now()) });
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
  }
  async function advance() {
    checkTime();
    await tab.playwright.locator('#search-results a.next').click();
    await tab.getAXState({ emit: false });
    return { pageNumber: ++pageNumber };
  }
  async function close() { if (tab) await tab.close(); }
  return { start, readPage, advance, close };
}
