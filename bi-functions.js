// Same dot cloud DOM surface as the other source collectors; never invokes application controls.
async function captureBiDom({directory,deadline}) {
 const marker='BI_DOM_RESULT:';
 async function call(code){
  const r=await tools.mcp__cua_repl__js({code,timeout_ms:120000,title:'读取BI原官网公开岗位列表'});
  const text=r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
  if(r.isError)throw Error('BI_DOM_TOOL_ERROR:'+text.slice(0,500));
  const i=text.lastIndexOf(marker);if(i<0)throw Error('BI_DOM_RESULT_MISSING');return JSON.parse(text.slice(i+marker.length));
 }
 const emit=x=>'nodeRepl.write('+JSON.stringify(marker)+'+JSON.stringify('+x+'));';
 await tools.mcp__cua_repl__js({code:'await cua.getState();',title:'检查原dot云浏览器'});
 let started=false,primary;
 try {
  await call('var biCaptureTab=await cua.createBrowserTab("cdp","https://campus.51job.com/BI/recruitSociety.html");'+emit('{started:true}'));started=true;
  if(Date.now()>=deadline)throw Error('BI_DOM_DEADLINE');
  const waitUntil=Math.min(deadline,Date.now()+30000);
  for(;;){
   const remaining=waitUntil-Date.now();if(remaining<=0)throw Error('BI_DOM_LOADING_TIMEOUT');
   try{
    await call('await biCaptureTab.playwright.locator(\'a[href*="recruit_article_detail3.html?jobId="]\').first().waitFor({state:"visible",timeoutMs:'+remaining+'});'+emit('{ready:true}'));
    if(Date.now()>=waitUntil)throw Error('BI_DOM_LOADING_TIMEOUT');
    break;
   }catch(error){
    if(!/selector deadline exceeded|locator\.waitFor\(visible\) timed out/.test(String(error))||Date.now()>=waitUntil)throw error;
   }
  }
  const result=await call('var biCaptureRows=await biCaptureTab.playwright.locator(\'a[href*="recruit_article_detail3.html?jobId="]\').evaluateAll(elements=>elements.map(a=>({href:a.getAttribute("href"),origin:a.origin,pathname:a.pathname,search:a.search,cells:Array.from(a.parentElement.children).map(e=>e.innerText),visible:!!a.getClientRects().length,html:a.parentElement.outerHTML})));'+emit('{captured_at:new Date().toISOString(),source_url:await biCaptureTab.url(),rows:biCaptureRows}'));
  if(Date.now()>=deadline)throw Error('BI_DOM_DEADLINE');
  if(result.source_url!=='https://campus.51job.com/BI/recruitSociety.html')throw Error('BI_DOM_SOURCE_IDENTITY');
  result.jobs=result.rows.map(row=>{const jobId=/(?:^\?|&)jobId=([^&]*)/.exec(row.search)?.[1];if(row.origin!=='https://campus.51job.com'||row.pathname!=='/BI/recruit_article_detail3.html'||!/^\d+$/.test(jobId??'')||!row.visible)throw Error('BI_DOM_JOB_IDENTITY');return {jobId,title:row.cells[1],job_number:row.cells[2],location:row.cells[3],published_at:row.cells[4],href:row.href,visible:row.visible};});
  if(new Set(result.jobs.map(row=>row.jobId)).size!==result.jobs.length)throw Error('BI_DOM_DUPLICATE');
  const saved=await tools.apply_patch('*** Begin Patch\n*** Add File: '+directory+'/dom-capture.json\n+'+JSON.stringify(result)+'\n*** End Patch');if(saved?.isError)throw Error('BI_DOM_ARCHIVE_FAILED');return result;
 }catch(error){
  primary=error;
  if(started){try{
   const failure=await call(emit('{captured_at:new Date().toISOString(),source_url:await biCaptureTab.url(),snapshot:await biCaptureTab.playwright.domSnapshot()}'));
   failure.error=String(error);
   const saved=await tools.apply_patch('*** Begin Patch\n*** Add File: '+directory+'/dom-failure.json\n+'+JSON.stringify(failure)+'\n*** End Patch');if(saved?.isError)throw Error('BI_DOM_ARCHIVE_FAILED');
  }catch(archiveError){primary=new Error(String(error)+';BI_DOM_FAILURE_ARCHIVE_FAILED:'+String(archiveError));}}
  throw primary;
 }
 finally {if(started){try{await call('await biCaptureTab.close();'+emit('{closed:true}'));}catch(error){if(!primary)throw error;}}}
}
return {captureBiDom};
