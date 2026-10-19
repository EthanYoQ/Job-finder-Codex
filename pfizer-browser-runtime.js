// Runs only inside the documented dot cloud cua_repl runtime.
var pfizerDomRuntime = (() => {
  const entry = 'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4';
  const prefix = 'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers';
  let list, detail, observedAt, deadline, total, totalPages, pageNumber = 1;
  const seen = new Set();
  function checkTime() { if (Date.now() >= deadline) throw Error('PFIZER_ORIGINAL_20_MINUTE_CAPTURE_DEADLINE'); }
  async function listState() {
    await list.playwright.locator('[data-automation-id="jobTitle"]').first().waitFor({state:'visible',timeoutMs:30000});
    await list.playwright.getByRole('button',{name:'China clear filter',exact:true}).waitFor({state:'visible',timeoutMs:30000});
    await list.playwright.locator('[data-automation-id="jobFoundText"]').filter({hasText:/^\d+ JOBS FOUND$/}).waitFor({state:'visible',timeoutMs:30000});
    const next = list.playwright.getByRole('button',{name:'next',exact:true});
    const clearAll = await list.playwright.getByRole('button',{name:/^Clear All \(\d+\)$/}).innerText();
    const value = {
      url:await list.url(), title:await list.title(),
      countryFilter:await list.playwright.getByRole('button',{name:'China clear filter',exact:true}).getAttribute('aria-label'),
      filterCount:Number(clearAll.match(/\((\d+)\)/)?.[1]),
      searchText:await list.playwright.getByRole('textbox',{name:'Search',exact:true}).evaluate(el=>el.value),
      pageLabel:await list.playwright.locator('ul[aria-label^="Page "]').getAttribute('aria-label'),
      range:await list.playwright.locator('[data-automation-id="jobOutOfText"]').innerText(),
      totalText:await list.playwright.locator('[data-automation-id="jobFoundText"]').innerText(),
      nextControlPresent:await next.count()===1 && await next.isVisible() && await next.isEnabled(),
      cards:await list.playwright.locator('[data-automation-id="jobTitle"]').evaluateAll(es=>es.map(e=>({href:e.href,title:e.textContent.trim()}))),
      domSnapshot:await list.playwright.domSnapshot()
    };
    value.capturedAt = new Date().toISOString();
    return value;
  }
  async function start(overallDeadline) {
    observedAt = new Date().toISOString();
    deadline = Math.min(Date.parse(observedAt) + 20*60*1000, overallDeadline ?? Infinity);
    list = await cua.createBrowserTab('cdp',entry);
    detail = await cua.createBrowserTab('cdp');
    return {observedAt,deadline};
  }
  async function readPage(sampleOnly=false) {
    checkTime();
    const listPage = await listState();
    const label = /^Page (\d+) of (\d+)$/.exec(listPage.pageLabel || '');
    const count = /^(\d+) JOBS FOUND$/.exec(listPage.totalText || '');
    if (!label || !count || Number(label[1])!==pageNumber) throw Error('PFIZER_DOM_PAGE_DECLARATION:'+JSON.stringify({expectedPage:pageNumber,pageLabel:listPage.pageLabel,totalText:listPage.totalText,range:listPage.range}));
    total ??= Number(count[1]); totalPages ??= Number(label[2]);
    if (Number(count[1])!==total || Number(label[2])!==totalPages || totalPages!==Math.ceil(total/20) || totalPages>20 ||
        listPage.cards.length!==Math.min(20,total-(pageNumber-1)*20) ||
        listPage.nextControlPresent!==(pageNumber<totalPages)) return {listPage,rows:[],failure:'PFIZER_DOM_PAGE_DRIFT_OR_TERMINAL',expected:{pageNumber,total,totalPages,cardCount:Math.min(20,total-(pageNumber-1)*20),nextControlPresent:pageNumber<totalPages}};
    const rows = [];
    for (const card of sampleOnly ? listPage.cards.slice(0,1) : listPage.cards) {
      checkTime();
      if (!card.href.startsWith(prefix+'/job/')) throw Error('PFIZER_DOM_DETAIL_SCOPE');
      const externalPath = new URL(card.href).pathname.slice('/en-US/PfizerCareers'.length);
      const officialId = /_(\d{7})(?:-\d+)?$/.exec(externalPath)?.[1];
      if (!officialId || seen.has(officialId)) throw Error('PFIZER_DOM_DUPLICATE_OR_INVALID_ID');
      await detail.goto(card.href);
      await detail.getAXState({emit:false});
      await detail.playwright.locator('[data-automation-id="jobPostingHeader"]').waitFor({state:'visible',timeoutMs:30000});
      await detail.playwright.getByRole('button',{name:'Apply',exact:true}).waitFor({state:'visible',timeoutMs:30000});
      const jsonLds = await detail.playwright.locator('script[type="application/ld+json"]').allTextContents();
      if (jsonLds.length!==1 || await detail.url()!==card.href) throw Error('PFIZER_DOM_DETAIL_IDENTITY');
      const row = {
        officialId, externalPath, title:card.title, detailUrl:await detail.url(),
        renderedTitle:(await detail.playwright.locator('[data-automation-id="jobPostingHeader"]').innerText()).trim(),
        renderedId:(await detail.playwright.locator('[data-automation-id="job-posting-details"] [data-automation-id="requisitionId"] dd').innerText()).trim(),
        renderedLocations:(await detail.playwright.locator('[data-automation-id="job-posting-details"] [data-automation-id="locations"] dd').allTextContents()).map(s=>s.trim()),
        applyEnabled:await detail.playwright.getByRole('button',{name:'Apply',exact:true}).isEnabled(),
        jsonLd:jsonLds[0], documentTitle:await detail.title(),
        domSnapshot:await detail.playwright.domSnapshot()
      };
      row.capturedAt = new Date().toISOString();
      rows.push(row); seen.add(officialId);
    }
    checkTime();
    return {listPage,rows};
  }
  async function advance() {
    checkTime();
    await list.playwright.getByRole('button',{name:'next',exact:true}).click();
    await list.getAXState({emit:false});
    pageNumber++;
    await list.playwright.locator('ul[aria-label="Page '+pageNumber+' of '+totalPages+'"]').waitFor({state:'attached',timeoutMs:30000});
    return {pageNumber};
  }
  async function close() {
    if (detail) await detail.close();
    if (list) await list.close();
  }
  return {start,readPage,advance,close};
})();

