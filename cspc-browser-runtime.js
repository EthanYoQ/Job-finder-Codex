// Load after cspc-dom-runtime-functions.js in the existing dot cloud CUA runtime.
var cspcDomRuntime = (() => {
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
})();

