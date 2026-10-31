// Runs only in the existing dot cloud cua_repl runtime; all evidence is native DOM.
var jnjDomRuntime = (() => {
  const origin = 'https://www.careers.jnj.com';
  const listUrl = page => origin+'/en/jobs/?'+(page===1?'':'page='+page+'&')+'country=China&origin=global#results';
  let list, detail, deadline, total, current = [], page = 1;
  const seen = new Set();
  const checkTime = () => { if (Date.now() >= deadline) throw Error('JNJ_ORIGINAL_30_MINUTE_CAPTURE_DEADLINE'); };
  const raw = value => JSON.stringify(value,null,2)+'\n';
  async function start(overallDeadline) {
    const startedAt = new Date().toISOString();
    deadline = Math.min(Date.parse(startedAt)+30*60*1000,overallDeadline ?? Infinity);
    checkTime();
    list = await cua.createBrowserTab('cdp',listUrl(1));
    detail = await cua.createBrowserTab('cdp');
    return {startedAt,deadline};
  }
  async function readList() {
    checkTime();
    let headingLocator;
    try {
      await list.playwright.locator('#js-job-search-results').waitFor({state:'visible',timeoutMs:30000});
      headingLocator = list.playwright.getByRole('heading',{name:total===undefined?/^Displaying 1 to \d+ of \d+ matching jobs$/:`Displaying ${(page-1)*20+1} to ${Math.min(page*20,total)} of ${total} matching jobs`,exact:true});
      await waitOriginalDomVisible(headingLocator,deadline);
    } catch(error) {
      const value={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',page,expectedUrl:listUrl(page),error:String(error),observedAt:new Date().toISOString()};
      try { value.url=await list.url(); } catch(readError) { value.urlReadError=String(readError); }
      try { value.dom=await list.playwright.domSnapshot(); } catch(readError) { value.domReadError=String(readError); }
      return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:value.error};
    }
    const heading = await headingLocator.innerText();
    const fragment = await list.playwright.locator('#js-job-search-results').evaluate(e=>({html:e.outerHTML,htmlLength:e.outerHTML.length,
      items:Array.from(e.children).map(e=>({text:e.innerText,links:Array.from(e.querySelectorAll('a[href*="/jobs/r-"]')).map(a=>({title:a.textContent.trim(),url:a.href}))}))}));
    const value = {kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:await list.url(),heading,fragment,
      filters:await list.playwright.locator('select[name]').evaluateAll(es=>es.map(e=>({id:e.id,name:e.name,selectedOptions:Array.from(e.selectedOptions).map(o=>({text:o.text,value:o.value}))}))),
      pagination:await list.playwright.getByRole('link',{name:/^(?:Page \d+|Next page|Previous page)$/}).evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),text:e.textContent.trim(),url:e.href}))),
      dom:await list.playwright.domSnapshot(),observedAt:new Date().toISOString()};
    const declaration = /^Displaying (\d+) to (\d+) of (\d+) matching jobs$/.exec(heading);
    if(!declaration) throw Error('JNJ_DOM_TOTAL_DECLARATION');
    total ??= Number(declaration[3]);
    if(value.url!==listUrl(page) || total<=0 || total>400 || Number(declaration[3])!==total ||
       Number(declaration[1])!==(page-1)*20+1 || Number(declaration[2])!==Math.min(page*20,total) ||
       fragment.items.length!==Math.min(20,total-(page-1)*20)) {
      return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:'JNJ_DOM_PAGE_DRIFT:'+JSON.stringify({page,expectedUrl:listUrl(page),actualUrl:value.url,heading,itemCount:fragment.items.length,total})};
    }
    const names=['team','subteam','country','state','location','type','pattern'];
    if(JSON.stringify(value.filters.map(f=>f.name))!==JSON.stringify(names) || value.filters.some(f=>JSON.stringify(f.selectedOptions)!==JSON.stringify(f.name==='country'?[{text:'China',value:'China'}]:[]))) throw Error('JNJ_DOM_SCOPE');
    for (const [index,item] of fragment.items.entries()) {
      if(item.links.length!==1) throw Error('JNJ_DOM_CARD_IDENTITY');
      const card=item.links[0],url=new URL(card.url),id=/^\/en\/jobs\/(r-\d+)\/[^/?#]+\/$/.exec(url.pathname)?.[1];
      if(!id || url.origin!==origin || url.username || url.password || url.search || url.hash || seen.has(id)) {
        // Preserve this real failed page before the Functions caller holds the source.
        return {file:'jnj-list-page-'+page+'.json',raw:raw(value),failure:'JNJ_DOM_DUPLICATE_OR_INVALID_ID:'+JSON.stringify({page,index,id:id??null,url:card.url,alreadySeen:seen.has(id)})};
      }
      seen.add(id);current.push({...card,id});
    }
    const next=value.pagination.filter(a=>a.label==='Next page');
    if(next.length!==(page<Math.ceil(total/20)?1:0) || next.length && next[0].url!==listUrl(page+1)) throw Error('JNJ_DOM_PAGINATION');
    checkTime();
    return {file:'jnj-list-page-'+page+'.json',raw:raw(value),rowCount:fragment.items.length,total,next:next.length===1};
  }
  async function readDetail(index) {
    checkTime();
    const card=current?.[index];
    if(!card) throw Error('JNJ_DOM_DETAIL_NOT_IN_CURRENT_PAGE');
    await detail.goto(card.url);
    await detail.getAXState({emit:false});
    await detail.playwright.locator('#js-job-detail').waitFor({state:'visible',timeoutMs:30000});
    await detail.playwright.getByRole('link',{name:'Apply now',exact:true}).waitFor({state:'visible',timeoutMs:30000});
    const value={kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:await detail.url(),expectedUrl:card.url,expectedTitle:card.title,
      heading:await detail.playwright.locator('h1').innerText(),
      body:await detail.playwright.locator('#js-job-detail').evaluate(e=>({html:e.outerHTML,htmlLength:e.outerHTML.length,text:e.innerText})),
      applyLinks:await detail.playwright.getByRole('link',{name:'Apply now',exact:true}).evaluateAll(es=>es.map(e=>({text:e.textContent.trim(),href:e.href}))),
      dom:await detail.playwright.domSnapshot(),observedAt:new Date().toISOString()};
    if(value.url!==card.url || value.heading.replace(/\s+/g,' ').trim()!==card.title.replace(/\s+/g,' ').trim()) throw Error('JNJ_DOM_DETAIL_IDENTITY');
    checkTime();
    return {file:card.id+'.json',raw:raw(value)};
  }
  async function advance() {
    checkTime();
    const nextUrl=await list.playwright.getByRole('link',{name:'Next page',exact:true}).evaluate(e=>e.href);
    if(nextUrl!==listUrl(page+1))throw Error('JNJ_DOM_PAGINATION');
    await list.goto(nextUrl);
    await list.getAXState({emit:false});
    page++;
    return {page};
  }
  async function close() { if(detail) await detail.close(); if(list) await list.close(); }
  return {start,readList,readDetail,advance,close};
})();
