// Original CSPC DOM collector with a local Chromium tab transport.
export function createCspcDomRuntime(cua) {
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
    const url = await tab.url();
    captures.push({
      row: rows[index],
      tabId: tab.id,
      clickStartedAt,
      navigationReadCompletedAt: new Date().toISOString(),
      url
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

async function captureCspcApplicationEntry(tab, deadline=Infinity) {
  const clickStartedAt = new Date().toISOString();
  await tab.playwright.frameLocator('#recruit-content-iframe').getByRole('button',{name:'投递',exact:true}).first().click();
  const clickCompletedAt = new Date().toISOString();
  await tab.getAXState({emit:false});
  // The four inspected entries currently open this login gate; never enter data.
  await waitCspcDomReady(tab,tab.playwright.getByRole('heading',{name:'登录',exact:true}),Math.min(deadline,Date.now()+30000));
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



  const sourceId='source-cspc-social',channelId='0beb3022-3214-4333-a2e7-20786c4916d5';
  const entryUrl='https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/'+channelId+'/officeWebsite.mob';
  let list,before,observationStartedAt,deadline;
  const rows=[],applications=[],owned=[];
  const checkTime=()=>{if(Date.now()>=deadline)throw Error('CSPC_CONTROL_WINDOW_EXPIRED');};
  function checkList(value) {
    const t=value.terminal;
    if(value.url!==entryUrl||value.listFilters.keyword!==''||value.listFilters.selectedFilters.length||
      t.disabledNextCount!==1||t.disabledJumpNextCount!==1||t.enabledNextCount!==0||t.loadMoreCount!==0||
      t.rowCount!==value.rows.length||t.rowCount<1)throw Error('CSPC_UNFILTERED_LIST_OR_TERMINAL_CHANGED');
  }
  function identity(url) {
    const u=new URL(url),id=u.searchParams.get('detailRequestId');
    if(u.origin+u.pathname!==entryUrl||u.searchParams.get('jumpPageId')!=='detail'||
      u.searchParams.get('rootId')!=='cspc'||u.searchParams.get('configId')!==channelId||
      u.searchParams.get('recruitWay')!=='e264521b-64fa-4e3b-aec7-720913ac635d'||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||''))throw Error('CSPC_OBSERVED_DETAIL_URL_SCOPE');
    return id;
  }
  async function start({runStartedAt,dispatchBefore}) {
    observationStartedAt=new Date().toISOString();
    deadline=Date.parse(dispatchBefore);
    if(!Number.isFinite(deadline)||!Number.isFinite(Date.parse(runStartedAt))||
      Date.parse(runStartedAt)>Date.parse(observationStartedAt))throw Error('CSPC_RUN_WINDOW_REQUIRED');
    checkTime();
    list=await cua.createBrowserTab('cdp');
    const navigationDeadline=Math.min(deadline,Date.now()+60000);
    try { await list.goto(entryUrl); }
    catch(error) {
      if(String(error?.message??error)!=='Timed out waiting for tab '+list.id+' to navigate to '+entryUrl+'.')throw error;
    }
    await waitCspcDomReady(list,list.playwright.frameLocator('#recruit-content-iframe').locator('.vxe-table--body tbody tr a').first(),navigationDeadline);
    await list.getAXState({emit:false});
    before=await readCspcListObservation(list);checkList(before);
    return {observationStartedAt,rowCount:before.rows.length,before};
  }
  async function readRow(index) {
    checkTime();
    if(index!==rows.length||index>=before.rows.length)throw Error('CSPC_SEQUENTIAL_ROW_INDEX');
    const captures=await captureCspcDomBatch(list,[index]);
    owned.push(captures[0].tabId);
    const [row]=await readCspcCompletedDetails(captures,deadline);
    if(row.row.title!==before.rows[index].title||row.row.text!==before.rows[index].text)throw Error('CSPC_LIST_ROW_DRIFT');
    row.officialId=identity(row.url);row.sourceJobId=channelId+':'+row.officialId;row.clickOrdinal=index+1;
    if(rows.some(r=>r.officialId===row.officialId))throw Error('CSPC_DUPLICATE_OFFICIAL_ID');
    if(row.detailSections.length!==2||row.detailSections.some(s=>!s.trim()))throw Error('CSPC_DETAIL_SECTIONS_MISSING');
    let application=null;
    if(row.detailSections.every(s=>s.trim()==='1')) {
      const tab=await cua.getTab(row.tabId,{browser:'cdp'});
      application={...await captureCspcApplicationEntry(tab,deadline),officialId:row.officialId,
        sourceJobId:row.sourceJobId,detailState:'DETAIL_INSUFFICIENT'};
      if(identity(application.url)!==row.officialId)throw Error('CSPC_APPLICATION_ID_DRIFT');
      applications.push(application);
    }
    rows.push(row);
    const tab=await cua.getTab(row.tabId,{browser:'cdp'});await tab.close();owned.splice(owned.indexOf(row.tabId),1);
    checkTime();return {row,application};
  }
  async function finish(sampleOnly=false) {
    checkTime();
    const after=await readCspcListObservation(list);checkList(after);
    if(JSON.stringify(after.rows)!==JSON.stringify(before.rows))throw Error('CSPC_FINAL_LIST_DRIFT');
    if(!sampleOnly&&rows.length!==after.rows.length)throw Error('CSPC_INCOMPLETE_LIST');
    const dom={schema:'dot-cloud-cdp-dom-navigation-observation-v1',
      purpose:sampleOnly?'READ_ONLY_DIAGNOSTIC_NOT_PRODUCTION_ACCEPTANCE':'CURRENT_RUN_INDEPENDENT_DOM_OBSERVATION',
      sourceId,channelId,entryUrl,tool:'mcp__cua_repl__js',browser:'cdp',networkCapture:false,
      sourceConfigurationCandidateCountIsOfficialTotal:false,applicationObservationsPending:false,
      observationStartedAt,observationCompletedAt:new Date().toISOString(),
      listFilters:after.listFilters,listObservationBefore:before,listObservationAfter:after,
      listSnapshotAfter:after.snapshot,terminal:{...after.terminal,readStartedAt:after.readStartedAt,readCompletedAt:after.readCompletedAt},rows};
    return {dom,applications:{schema:'dot-cloud-cdp-application-entry-observation-v1',sourceId,
      tool:'mcp__cua_repl__js',observations:applications}};
  }
  async function failureState() {
    if(!list) return {readError:'CSPC_LIST_HANDLE_UNAVAILABLE_AFTER_START_FAILURE'};
    const value={};
    try { value.url=await list.url(); } catch(error) { value.urlReadError=String(error?.message??error); }
    try { value.domSnapshot=await list.playwright.domSnapshot(); } catch(error) { value.domReadError=String(error?.message??error); }
    return value;
  }
  async function close() {
    for(const id of owned){const tab=await cua.getTab(id,{browser:'cdp'});await tab.close();}
    if(list)await list.close();
  }
  return {start,readRow,finish,failureState,close};
}



