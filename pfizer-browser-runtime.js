// Runs only inside the documented dot cloud cua_repl runtime.
var pfizerDomRuntime = (() => {
  const entry = 'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4';
  const prefix = 'https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers';
  let list, detail, observedAt, deadline, total, totalPages, pageNumber = 1, active, stage = 'start';
  const seen = new Set();
  function checkTime() { if (Date.now() >= deadline) throw Error('PFIZER_ORIGINAL_20_MINUTE_CAPTURE_DEADLINE'); }
  function listSlots(listPage) {
    const cards = listPage.cards;
    const label = /^Page (\d+) of (\d+)$/.exec(String(listPage.pageLabel));
    const total = /^(\d+) JOBS FOUND$/.exec(String(listPage.totalText));
    if (!label || !total || !Array.isArray(cards)) throw Error('PFIZER_DOM_SLOT_DECLARATION');
    const expected = Math.min(20, Number(total[1]) - (Number(label[1]) - 1) * 20);
    const complete = cards.map(card => ({officialId:/_(\d{7})(?:-\d+)?$/.exec(new URL(card.href).pathname)?.[1] ?? '',card}));
    if (complete.some(row=>!row.officialId) || new Set(complete.map(row=>row.officialId)).size!==complete.length) throw Error('PFIZER_DOM_DUPLICATE_OR_INVALID_ID');
    if (cards.length===expected) return complete;
    if (cards.length>expected || typeof listPage.domSnapshot!=='string') throw Error('PFIZER_DOM_UNEXPLAINED_MISSING_SLOT');
    const section=/- list "Page \d+ of \d+":\n([\s\S]*?)(?=\n\s*- navigation "pagination":)/.exec(listPage.domSnapshot)?.[1];
    if (!section) throw Error('PFIZER_DOM_LIST_EVIDENCE_MISSING');
    const slots=[];let previousEnd=0;
    for (const match of section.matchAll(/^[ \t]*- listitem: "(\d{7})"$/gm)) {
      const officialId=match[1],end=match.index+match[0].length,card=complete.find(row=>row.officialId===officialId)?.card;
      const domRow=section.slice(previousEnd,end).trim();previousEnd=end;
      if (!card && !new RegExp(`^- list:\n[ \t]+- listitem: "${officialId}"$`).test(domRow)) throw Error('PFIZER_DOM_UNREVIEWED_MISSING_SLOT');
      slots.push(card?{officialId,card}:{officialId,domRow});
    }
    if (slots.length!==expected || new Set(slots.map(row=>row.officialId)).size!==expected || slots.filter(row=>row.card).length!==cards.length ||
        slots.filter(row=>row.card).some((row,index)=>row.card!==cards[index])) throw Error('PFIZER_DOM_SLOT_SET_MISMATCH');
    return slots;
  }
  async function listState() {
    stage = 'list-title-wait';
    await list.playwright.locator('[data-automation-id="jobTitle"]').first().waitFor({state:'visible',timeoutMs:30000});
    stage = 'list-country-wait';
    await list.playwright.getByRole('button',{name:'China clear filter',exact:true}).waitFor({state:'visible',timeoutMs:30000});
    stage = 'list-total-wait';
    await list.playwright.locator('[data-automation-id="jobFoundText"]').filter({hasText:/^\d+ JOBS FOUND$/}).waitFor({state:'visible',timeoutMs:30000});
    stage = 'list-observation';
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
    list = await cua.createBrowserTab('cdp',entry); active = list;
    detail = await cua.createBrowserTab('cdp');
    return {observedAt,deadline};
  }
  async function readPage(sampleOnly=false) {
    active = list; stage = 'read-page';
    checkTime();
    const listPage = await listState();
    stage = 'list-validation';
    const label = /^Page (\d+) of (\d+)$/.exec(listPage.pageLabel || '');
    const count = /^(\d+) JOBS FOUND$/.exec(listPage.totalText || '');
    if (!label || !count || Number(label[1])!==pageNumber) throw Error('PFIZER_DOM_PAGE_DECLARATION:'+JSON.stringify({expectedPage:pageNumber,pageLabel:listPage.pageLabel,totalText:listPage.totalText,range:listPage.range}));
    total ??= Number(count[1]); totalPages ??= Number(label[2]);
    let slots;
    try { slots=listSlots(listPage); } catch (error) {
      return {listPage,rows:[],failure:String(error.message),expected:{pageNumber,total,totalPages,cardCount:Math.min(20,total-(pageNumber-1)*20),nextControlPresent:pageNumber<totalPages}};
    }
    if (Number(count[1])!==total || Number(label[2])!==totalPages || totalPages!==Math.ceil(total/20) || totalPages>20 ||
        slots.length!==Math.min(20,total-(pageNumber-1)*20) ||
        listPage.nextControlPresent!==(pageNumber<totalPages)) return {listPage,rows:[],failure:'PFIZER_DOM_PAGE_DRIFT_OR_TERMINAL',expected:{pageNumber,total,totalPages,cardCount:Math.min(20,total-(pageNumber-1)*20),nextControlPresent:pageNumber<totalPages}};
    const rows = [];
    for (const slot of sampleOnly ? slots.slice(0,1) : slots) {
      active = list; stage = 'card-validation';
      checkTime();
      if (!slot.card) {
        if (seen.has(slot.officialId)) throw Error('PFIZER_DOM_DUPLICATE_OR_INVALID_ID');
        rows.push({officialId:slot.officialId,quarantineCode:'PFIZER_LIST_ROW_UNKNOWN',noOmissionVerified:false,domRow:slot.domRow,capturedAt:listPage.capturedAt});
        seen.add(slot.officialId);continue;
      }
      const card=slot.card;
      if (!card.href.startsWith(prefix+'/job/')) throw Error('PFIZER_DOM_DETAIL_SCOPE');
      const externalPath = new URL(card.href).pathname.slice('/en-US/PfizerCareers'.length);
      const officialId = /_(\d{7})(?:-\d+)?$/.exec(externalPath)?.[1];
      if (!officialId || seen.has(officialId)) throw Error('PFIZER_DOM_DUPLICATE_OR_INVALID_ID');
      active = detail; stage = 'detail-navigation';
      await detail.goto(card.href);
      stage = 'detail-accessibility';
      await detail.getAXState({emit:false});
      stage = 'detail-title-wait';
      await waitOriginalDomVisible(detail.playwright.locator('[data-automation-id="jobPostingHeader"]'),deadline);
      stage = 'detail-apply-wait';
      await detail.playwright.getByRole('button',{name:'Apply',exact:true}).waitFor({state:'visible',timeoutMs:30000});
      stage = 'detail-observation';
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
    active = list; stage = 'advance';
    checkTime();
    await list.playwright.getByRole('button',{name:'next',exact:true}).click();
    await list.getAXState({emit:false});
    pageNumber++; stage = 'pagination-wait';
    await list.playwright.locator('ul[aria-label="Page '+pageNumber+' of '+totalPages+'"]').waitFor({state:'attached',timeoutMs:30000});
    return {pageNumber};
  }
  async function failureState() {
    const value={stage,pageNumber,observedAt:new Date().toISOString()};
    if(!active) return {...value,readError:'PFIZER_ACTIVE_TAB_UNAVAILABLE'};
    value.tab=active===detail?'detail':'list';
    try { value.url=await active.url(); } catch(error) { value.urlReadError=String(error); }
    try { value.domSnapshot=await active.playwright.domSnapshot(); } catch(error) { value.domReadError=String(error); }
    return value;
  }
  async function close() {
    if (detail) await detail.close();
    if (list) await list.close();
  }
  return {start,readPage,advance,failureState,close};
})();

