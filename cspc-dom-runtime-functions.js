// Inactive, reusable cloud-cdp DOM diagnostic helper.
// The core navigation loop was exercised successfully in five batches in this session.
// This packaging is not yet an end-to-end tested production adapter.
// Execute in mcp__cua_repl__js after its required first call, await cua.getState(),
// and after creating/binding the exact original CSPC entry in browser "cdp".
// Functions runtime can invoke the tool directly; a Node child cannot import this API.
// Never label this as waitForResponse/postData or network capture.

async function waitCspcDomReady(tab, locator, deadline=Infinity) {
  // The cloud backend can cap one wait below timeoutMs. Keep the same loading tab.
  const until=Math.min(deadline,Date.now()+60000);
  while(Date.now()<until) {
    try {
      await tab.playwright.waitForLoadState({state:'load',timeoutMs:Math.min(10000,until-Date.now())});
      await locator.waitFor({state:'visible',timeoutMs:Math.max(1,Math.min(10000,until-Date.now()))});
      return;
    } catch(error) {
      if(!/Timed out waiting for load|Runtime.evaluate timed out|locator.waitFor\(visible\) timed out/.test(String(error)))throw error;
    }
  }
  throw Error('CSPC_DOM_LOADING_TIMEOUT');
}

async function captureCspcDomBatch(listTab, indices) {
  const frame = listTab.playwright.frameLocator('#recruit-content-iframe');
  const rows = await frame.locator('.vxe-table--body tbody tr').evaluateAll(elements =>
    elements.map((row, index) => ({
      index,
      title: row.querySelector('a').innerText,
      text: row.innerText
    }))
  );
  const captures = [];
  for (const index of indices) {
    await listTab.getAXState({emit: false});
    const before = await cua.listTabs({browser: 'cdp', emit: false});
    const clickStartedAt = new Date().toISOString();
    await frame.locator('.vxe-table--body tbody tr').nth(index).locator('a').click();
    await listTab.getAXState({emit: false});
    const after = await cua.listTabs({browser: 'cdp', emit: false});
    const added = after.filter(tab => !before.some(previous => previous.id === tab.id));
    if (added.length !== 1) throw Error('Expected exactly one new detail tab');
    const tab = await cua.getTab(added[0].id, {browser: 'cdp'});
    const initialSnapshot = await tab.playwright.domSnapshot();
    const url = await tab.url();
    captures.push({
      row: rows[index],
      tabId: tab.id,
      clickStartedAt,
      navigationReadCompletedAt: new Date().toISOString(),
      url,
      initialSnapshot
    });
  }
  return captures;
}

async function readCspcCompletedDetails(captures, deadline=Infinity) {
  const completed = [];
  for (const capture of captures) {
    const tab = await cua.getTab(capture.tabId, {browser: 'cdp'});
    const frame = tab.playwright.frameLocator('#recruit-content-iframe');
    await waitCspcDomReady(tab,frame.locator('.school-recruit-detail-head-L-h1 span').first(),deadline);
    await frame.locator('.school-recruit-detail-textBox').nth(1).waitFor({state:'visible',timeoutMs:30000});
    const readStartedAt = new Date().toISOString();
    const snapshot = await tab.playwright.domSnapshot();
    const url = await tab.url();
    const frameUrl = await tab.playwright.evaluate(() =>
      document.querySelector('#recruit-content-iframe')?.getAttribute('src')
    );
    const detailSections = await frame.locator('.school-recruit-detail-textBox').allTextContents();
    const readCompletedAt = new Date().toISOString();
    completed.push({...capture, readStartedAt, readCompletedAt, url, frameUrl, snapshot, detailSections});
  }
  return completed;
}

// The caller must separately inspect the original list terminal controls,
// require actual detail DOM readiness, extract IDs only from observed detail URLs,
// and compare both ID sets against a new independent original HTTP collection.
// Application inspection may stop at a login form. Do not fill or submit it.
// Do not synthesize a browser request, response body, request timestamp, or total.

async function readCspcListObservation(listTab) {
  const readStartedAt = new Date().toISOString();
  const frame = listTab.playwright.frameLocator('#recruit-content-iframe');
  const listFilters = await frame.locator('body').evaluate(el => ({
    keyword: el.querySelector('input[placeholder="请输入岗位名称"]').value,
    selectedFilters: Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(input => input.value)
  }));
  const terminal = await frame.locator('body').evaluate(el => ({
    rowCount: el.querySelectorAll('.vxe-table--body tbody tr').length,
    disabledNextCount: el.querySelectorAll('.vxe-pager--next-btn.is--disabled').length,
    disabledJumpNextCount: el.querySelectorAll('.vxe-pager--jump-next.is--disabled').length,
    enabledNextCount: el.querySelectorAll('.vxe-pager--next-btn:not(.is--disabled)').length,
    loadMoreCount: el.querySelectorAll('[class*="load-more"]').length,
    pagerClass: el.querySelector('.vxe-pager')?.className,
    pagerText: el.querySelector('.vxe-pager')?.innerText
  }));
  const snapshot = await listTab.playwright.domSnapshot();
  const rows = await frame.locator('.vxe-table--body tbody tr').evaluateAll(elements => elements.map((row,index)=>({index,title:row.querySelector('a').innerText,text:row.innerText})));
  const rootHtml = await listTab.playwright.evaluate(() => document.documentElement.outerHTML);
  const frameHtml = await frame.locator('html').evaluate(el => el.outerHTML);
  const url = await listTab.url();
  return {purpose:'CURRENT_RUN_INDEPENDENT_DOM_OBSERVATION',readStartedAt,
    readCompletedAt:new Date().toISOString(),url,listFilters,terminal,rows,snapshot,rootHtml,frameHtml};
}

async function captureCspcApplicationEntry(tab) {
  const clickStartedAt = new Date().toISOString();
  await tab.playwright.frameLocator('#recruit-content-iframe').getByRole('button',{name:'投递',exact:true}).first().click();
  const clickCompletedAt = new Date().toISOString();
  await tab.getAXState({emit:false});
  // The four inspected entries currently open this login gate; never enter data.
  await tab.playwright.getByRole('heading',{name:'登录',exact:true}).waitFor({state:'visible',timeoutMs:30000});
  const readStartedAt = new Date().toISOString();
  const snapshot = await tab.playwright.domSnapshot();
  const rootHtml = await tab.playwright.evaluate(() => document.documentElement.outerHTML);
  const frameHtml = await tab.playwright.frameLocator('#recruit-content-iframe').locator('html').evaluate(el => el.outerHTML);
  const url = await tab.url();
  return {url,clickStartedAt,clickCompletedAt,readStartedAt,readCompletedAt:new Date().toISOString(),
    snapshot,rootHtml,frameHtml,
    applicationState:'LOGIN_REQUIRED_POST_LOGIN_STATUS_UNVERIFIED',
    personalDataEntered:false,loginPerformed:false,applicationSubmitted:false};
}


