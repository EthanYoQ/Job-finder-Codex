// Offline migration candidate. The round still blocks browser sources; no entrypoint runs this file.
// Keep the current DOM traversal and archive contracts, replacing only Functions/CUA I/O.
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (directory, name, value) => writeFile(join(directory, name), JSON.stringify(value, null, 2)+'\n', {flag:'wx', mode:0o600});
const provenance = {tool:'playwright-core', browser:'chromium', snapshotFormat:'local-chromium-aria-snapshot-v1', networkCapture:false};

async function originalRuntime(sourceRoot, name, cua) {
  const helper = await readFile(join(sourceRoot, 'cspc-dom-runtime-functions.js'), 'utf8');
  const source = await readFile(join(sourceRoot, name+'-browser-runtime.js'), 'utf8');
  return new AsyncFunction('cua', helper+'\n'+source+'\nreturn '+name+'DomRuntime;')(cua);
}

export async function captureBrowserEvidence({sourceId, cua, sourceRoot, run, deadline}) {
  if(!Number.isFinite(deadline)||deadline<=Date.now()) throw Error('BROWSER_CAPTURE_DEADLINE_REQUIRED');
  const kind = {'source-cspc-social':'cspc','source-boehringer-ingelheim-china-social':'bi','source-johnson-innovative-medicine-social':'jnj'}[sourceId];
  if(!kind) throw Error('BROWSER_SOURCE_NOT_PORTED');
  const directory = join(run, kind==='jnj'?'native-dom':'independent-dom');
  await mkdir(directory, {recursive:true, mode:0o700});
  if((await readdir(directory)).length) throw Error('BROWSER_FRESH_DIRECTORY_REQUIRED');
  await cua.getState();
  if(kind==='bi') return captureBi(cua, directory, deadline);
  const runtime = await originalRuntime(sourceRoot, kind, cua);
  try {
    if(kind==='cspc') {
      const runStartedAt = new Date().toISOString();
      await save(run, 'run-start.json', {runStartedAt});
      const started = await runtime.start({runStartedAt, dispatchBefore:new Date(deadline).toISOString()});
      await save(directory, 'list-before.json', started.before);
      for(let index=0;index<started.rowCount;index++) {
        if(Date.now()>=deadline) throw Error('CSPC_CONTROL_WINDOW_EXPIRED');
        await save(directory, 'row-'+String(index+1).padStart(3,'0')+'.json', await runtime.readRow(index));
      }
      const result = await runtime.finish(false);
      // The existing schema identifiers describe the wire shape, not the actual transport.
      // Correct legacy runtime metadata before saving; never claim this used the cloud CUA tool.
      await save(directory, 'navigation-evidence.json', {...result.dom, ...provenance});
      await save(directory, 'application-observations.json', {...result.applications, ...provenance});
      return {directory, ...provenance};
    }
    const started = await runtime.start(deadline);
    const put = async ({file,raw}) => {
      if(!/^(?:jnj-list-page-[1-9]\d*|r-\d+)\.json$/.test(file)||!raw.endsWith('\n')) throw Error('JNJ_DOM_ARCHIVE_IDENTITY');
      // JNJ's existing observation schema is strict; transport metadata belongs in
      // the manifest and the accurately labelled snapshot, not extra record keys.
      await writeFile(join(directory,file),raw,{flag:'wx',mode:0o600});
    };
    for(let page=1;page<=20;page++) {
      if(Date.now()>=started.deadline) throw Error('JNJ_ORIGINAL_30_MINUTE_CAPTURE_DEADLINE');
      const list = await runtime.readList(); await put(list);
      if(list.failure) throw Error(list.failure);
      if(!list.next) {
        for(let index=0;index<list.total;index++) await put(await runtime.readDetail(index));
        const files = [];
        for(const file of (await readdir(directory)).filter(f=>f.endsWith('.json')).sort()) {
          const bytes = await readFile(join(directory,file)); files.push({file,bytes:bytes.length,sha256:sha(bytes)});
        }
        await save(directory, 'manifest.json', {kind:'BROWSER_UI_DOM_EVIDENCE_NOT_HTTP',files,...provenance});
        const path = join(directory,'manifest.json');
        return {directory,manifest:{path,sha256:sha(await readFile(path))},currentCapturePreparationRequired:true};
      }
      await runtime.advance();
    }
    throw Error('JNJ_ORIGINAL_20_PAGE_LIMIT');
  } catch(error) {
    if(kind==='cspc') {
      let state; try {state=await runtime.failureState();} catch {state={readError:'BROWSER_FAILURE_STATE_UNAVAILABLE'};}
      await save(directory,'capture-error.json',{error:String(error),observedAt:new Date().toISOString(),state,...provenance});
    }
    throw error;
  } finally {await runtime.close();}
}

async function captureBi(cua, directory, deadline) {
  const entry = 'https://campus.51job.com/BI/recruitSociety.html';
  const tab = await cua.createBrowserTab('cdp',entry);
  try {
    const remaining = Math.min(30000,deadline-Date.now());
    if(remaining<=0) throw Error('BI_DOM_DEADLINE');
    const locator = tab.playwright.locator('a[href*="recruit_article_detail3.html?jobId="]');
    await locator.first().waitFor({state:'visible',timeoutMs:remaining});
    const rows = await locator.evaluateAll(elements=>elements.map(a=>({href:a.getAttribute('href'),origin:a.origin,pathname:a.pathname,search:a.search,cells:Array.from(a.parentElement.children).map(e=>e.innerText),visible:!!a.getClientRects().length,html:a.parentElement.outerHTML})));
    const result = {captured_at:new Date().toISOString(),source_url:await tab.url(),rows,...provenance};
    if(Date.now()>=deadline) throw Error('BI_DOM_DEADLINE');
    if(result.source_url!==entry) throw Error('BI_DOM_SOURCE_IDENTITY');
    result.jobs=rows.map(row=>{
      const jobId=/(?:^\?|&)jobId=([^&]*)/.exec(row.search)?.[1];
      if(row.origin!=='https://campus.51job.com'||row.pathname!=='/BI/recruit_article_detail3.html'||!/^\d+$/.test(jobId??'')||!row.visible) throw Error('BI_DOM_JOB_IDENTITY');
      return {jobId,title:row.cells[1],job_number:row.cells[2],location:row.cells[3],published_at:row.cells[4],href:row.href,visible:row.visible};
    });
    if(new Set(result.jobs.map(row=>row.jobId)).size!==result.jobs.length) throw Error('BI_DOM_DUPLICATE');
    await save(directory,'dom-capture.json',result); return {directory,...provenance};
  } catch(error) {
    await save(directory,'dom-failure.json',{captured_at:new Date().toISOString(),source_url:await tab.url(),snapshot:await tab.playwright.domSnapshot(),error:String(error),...provenance});
    throw error;
  } finally {await tab.close();}
}
