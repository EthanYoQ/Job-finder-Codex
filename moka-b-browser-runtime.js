// Runs inside the existing dot cloud cua_repl runtime; reads rendered DOM only.
var mokaBDomRuntime = (() => {
  const entries = {
    bayer: 'https://app.mokahr.com/social-recruitment/bayer/148387?locale=zh-CN#/jobs',
    servier: 'https://app.mokahr.com/social-recruitment/shiweiya/47734#/jobs'
  };
  let tab, source, deadline, pageNumber, total, previousFirst;
  function checkTime() { if (Date.now() >= deadline) throw Error('MOKA_B_ORIGINAL_CAPTURE_DEADLINE'); }
  async function waitDomReady(locator) {
    // Same bounded wait as the original CSPC Functions runtime: the backend caps one wait below timeoutMs.
    const until = Math.min(deadline, Date.now() + 60000);
    while (Date.now() < until) {
      try {
        await tab.playwright.waitForLoadState({ state: 'load', timeoutMs: Math.min(10000, until - Date.now()) });
        await locator.waitFor({ state: 'visible', timeoutMs: Math.max(1, Math.min(10000, until - Date.now())) });
        return;
      } catch (error) {
        if (!/Timed out waiting for load|Runtime.evaluate timed out|locator.waitFor\(visible\) timed out/.test(String(error))) throw error;
      }
    }
    throw Error('MOKA_B_DOM_LOADING_TIMEOUT');
  }
  async function start(name, overallDeadline) {
    if (!Object.hasOwn(entries, name)) throw Error('MOKA_B_SOURCE');
    source = name; pageNumber = 1; total = undefined; previousFirst = undefined;
    deadline = Math.min(Date.now() + 20 * 60 * 1000, overallDeadline ?? Infinity);
    checkTime();
    tab = await cua.createBrowserTab('cdp', entries[source]);
    try {
      if (source === 'bayer') {
        await tab.playwright.getByRole('checkbox', { name: 'Pharmaceuticals Pharmaceuticals', exact: true }).check();
        await tab.getAXState({ emit: false });
        await tab.playwright.getByRole('checkbox', { name: 'Consumer Health Consumer Health', exact: true }).check();
      }
      await tab.getAXState({ emit: false });
      return { deadline };
    } catch (error) { await tab.close(); throw error; }
  }
  async function readPage() {
    checkTime();
    await waitDomReady(tab.playwright.locator('button[class*="Pagination-is-active"][data-page="' + pageNumber + '"]'));
    if (previousFirst) await tab.playwright.locator('a[href="' + previousFirst + '"] [class^="published-at-"]').waitFor({ state: 'detached', timeoutMs: 30000 });
    await tab.playwright.locator('a[href^="#/job/"] [class^="published-at-"]').first().waitFor({ state: 'visible', timeoutMs: 30000 });
    const summaryText = await tab.playwright.getByText(/已选\s*\d+\s*条件/).evaluate(e => Array.from(e.parentElement.children).slice(0, 3).map(n => n.textContent).join(' '));
    const summary = /^已选\s*(\d+)\s*条件\s*\|\s*(\d+)\s*结果$/.exec(summaryText.trim());
    const selected = await tab.playwright.getByRole('checkbox').evaluateAll(es => es.filter(e => e.checked).map(e => e.closest('label').querySelector('.no-adaptive-tooltip').textContent.trim()));
    const searchValues = await tab.playwright.getByRole('textbox').evaluateAll(es => es.map(e => e.value.trim()).filter(Boolean));
    const pageSizeText = await tab.playwright.locator('[class*="Pagination-page-size-changer-"]').innerText();
    const pageSize = Number(/^(\d+)\s*行\/页$/.exec(pageSizeText.trim())?.[1]);
    const currentPage = Number(await tab.playwright.locator('button[class*="Pagination-is-active"]').innerText());
    const nextDisabled = !await tab.playwright.locator('button[class*="Pagination-forward"]').isEnabled();
    const rows = await tab.playwright.locator('a[href^="#/job/"]').evaluateAll(es => es.filter(e => e.querySelector('[class^="published-at-"]')).map(e => ({
      href: e.getAttribute('href'), titleHtml: e.querySelector('[class^="title-"]').outerHTML,
      publishedHtml: e.querySelector('[class^="published-at-"]').outerHTML
    })));
    total ??= Number(summary?.[2]);
    if (!summary || Number(summary[1]) !== (source === 'bayer' ? 1 : 0) || Number(summary[2]) !== total || !Number.isSafeInteger(total) || total < 1 ||
        pageSize !== 30 || currentPage !== pageNumber || rows.length !== Math.min(30, total - (pageNumber - 1) * 30) ||
        nextDisabled !== (pageNumber === Math.ceil(total / 30)) || searchValues.length ||
        JSON.stringify(selected) !== JSON.stringify(source === 'bayer' ? ['Pharmaceuticals', 'Consumer Health'] : [])) throw Error('MOKA_B_DOM_SCOPE_OR_PAGINATION');
    const page = { url: await tab.url(), summaryText, pageNumber: currentPage, pageSize, nextDisabled,
      ...(source === 'bayer' ? { selectedDivisions: selected } : { selectedFilters: selected }),
      paginationHtml: await tab.playwright.locator('button[class*="Pagination-forward"]').evaluate(e => e.parentElement.outerHTML), rows,
      capturedAt: new Date().toISOString() };
    previousFirst = rows[0].href;
    checkTime();
    return page;
  }
  async function advance() {
    checkTime();
    await tab.playwright.locator('button[class*="Pagination-forward"]').click();
    await tab.getAXState({ emit: false });
    pageNumber++;
    return { pageNumber };
  }
  async function close() { if (tab) await tab.close(); }
  return { start, readPage, advance, close };
})();
