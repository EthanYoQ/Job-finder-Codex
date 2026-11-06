const browserName = name => { if (name !== undefined && name !== 'cdp') throw Error('LOCAL_CHROMIUM_BROWSER_REQUIRED'); };
function options(value) {
  if (!value) return value;
  const {timeoutMs, ...rest} = value;
  return timeoutMs === undefined ? rest : {...rest, timeout: timeoutMs};
}

// Only the locator methods used by the existing DOM collectors; no script/tool evaluator.
function locator(native) {
  const wrapped = {};
  for (const name of ['locator','frameLocator','getByRole','getByText','first','last','nth','filter']) {
    if (typeof native[name] === 'function') wrapped[name] = (...args) => locator(native[name](...args));
  }
  for (const name of ['click','check','uncheck','waitFor','innerText','isEnabled','isVisible']) {
    if (typeof native[name] === 'function') wrapped[name] = value => native[name](options(value));
  }
  for (const name of ['fill','press','getAttribute','selectOption']) {
    if (typeof native[name] === 'function') wrapped[name] = (value, config) => native[name](value, options(config));
  }
  for (const name of ['evaluate','evaluateAll','allTextContents','count']) {
    if (typeof native[name] === 'function') wrapped[name] = (...args) => native[name](...args);
  }
  return wrapped;
}

/** Local Playwright transport with the existing collectors' tab/locator vocabulary.
 * Snapshots are local Chromium ARIA observations, not CUA or network evidence.
 * Does not grant source access, produce source admission, or change any HOLD.
 */
export async function createChromiumDom({chromium, executablePath = '/usr/bin/chromium', netLogPath}) {
  const allowed = new Set(['COMSPEC','FONTCONFIG_PATH','HOME','LANG','LANGUAGE','LC_ALL','LOGNAME','PATH','PATHEXT',
    'SSL_CERT_DIR','SSL_CERT_FILE','SYSTEMROOT','TEMP','TMP','TMPDIR','TZ','USER','WINDIR',
    'XDG_CACHE_HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_RUNTIME_DIR']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  const browser = await chromium.launch({executablePath, headless: true, chromiumSandbox: true, env,
    ...(netLogPath?{args:[`--log-net-log=${netLogPath}`,'--net-log-max-size-mb=10','--net-log-duration=60']}: {})});
  let context;
  try { context = await browser.newContext(); }
  catch (error) { await browser.close(); throw error; }
  const tabs = new Map(), pages = new WeakMap();
  let sequence = 0;
  function tabFor(page) {
    if (pages.has(page)) return pages.get(page);
    const id = 'local-chromium-' + (++sequence);
    const snapshot = async () => {
      const frames = [];
      for (const frame of page.frames()) frames.push({url: frame.url(), aria: await frame.locator('body').ariaSnapshot()});
      return ['LOCAL_CHROMIUM_ARIA_SNAPSHOT', `Page: ${page.url()}`, 'networkCapture: false',
        ...frames.map(frame => `Frame: ${frame.url}\n${frame.aria}`)].join('\n');
    };
    let navigationInfo,cspcListResponse,cspcAccessBlock;
    page.on('response',response=>{
      if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())
        navigationInfo={httpStatus:response.status(),retryAfter:response.headers()['retry-after']};
      const url=new URL(response.url());
      if(url.origin==='https://ehr.e-cspc.com:8081'&&url.pathname.startsWith('/RedseaPlatform/')&&[403,429].includes(response.status())&&
        (response.request().isNavigationRequest()||['fetch','xhr'].includes(response.request().resourceType?.())))
        cspcAccessBlock={httpStatus:response.status(),retryAfter:response.headers()['retry-after']??null};
      if(url.origin==='https://ehr.e-cspc.com:8081'&&url.pathname==='/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob'&&response.request().method()==='POST'){
        const form=new URLSearchParams(response.request().postData()??''),fields=['channelQrId','root_id','recruit_way','sortName','push_request_id','keyword','ftl_list_stru_id'];
        // Private failure diagnostics only: no headers, cookies, personal fields or response job bodies.
        const record={httpStatus:response.status(),scope:Object.fromEntries([...form].filter(([key])=>fields.includes(key))),
          otherNonEmptyFieldCount:[...form].filter(([key,value])=>value&&!fields.includes(key)).length};
        cspcListResponse=record;
        void response.json().then(data=>{record.result={state:data.state??null,total:data.total??null,jsonListCount:Array.isArray(data.jsonList)?data.jsonList.length:null};})
          .catch(()=>{record.resultUnavailable=true;});
      }
    });
    const tab = {id, url: async () => page.url(),
      clickAndWaitForPopup:async(click,timeoutMs)=>{
        const deadline=Date.now()+timeoutMs;
        const settled=await Promise.allSettled([page.waitForEvent('popup',{timeout:timeoutMs}),click()]);
        const failure=settled.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        const popup=settled[0].value,remaining=deadline-Date.now();if(remaining<=0)throw Error('CSPC_DETAIL_POPUP_TIMEOUT');
        await popup.waitForLoadState('domcontentloaded',{timeout:remaining});return tabFor(popup);
      }, navigationInfo: async () => cspcAccessBlock?{...navigationInfo,...(cspcListResponse?{cspcListResponse}:{}),cspcAccessBlock}:cspcListResponse?{...navigationInfo,cspcListResponse}:navigationInfo,
      goto: async (url, config) => {
        navigationInfo=undefined;cspcListResponse=undefined;cspcAccessBlock=undefined;
        const response=await page.goto(url, {waitUntil:'domcontentloaded',...options(config)});
        navigationInfo=response?{httpStatus:response.status(),retryAfter:await response.headerValue('retry-after')}:undefined;
        return response;
      },
      close: () => page.close(), getAXState: snapshot,
      playwright: {
        locator: (...args) => locator(page.locator(...args)),
        frameLocator: (...args) => locator(page.frameLocator(...args)),
        getByRole: (...args) => locator(page.getByRole(...args)),
        getByText: (...args) => locator(page.getByText(...args)),
        evaluate: (...args) => page.evaluate(...args),
        waitForLoadState: ({state = 'load', ...config} = {}) => page.waitForLoadState(state, options(config)),
        domSnapshot: snapshot
      }};
    tabs.set(id, tab); pages.set(page, tab);
    page.once('close', () => tabs.delete(id));
    return tab;
  }
  context.on('page', tabFor);
  const listTabs = async ({browser: name} = {}) => {
    browserName(name);
    return context.pages().map(page => ({id: tabFor(page).id, url: page.url(), browser: 'cdp', transport: 'LOCAL_CHROMIUM'}));
  };
  return {
    transport: 'LOCAL_CHROMIUM',
    createBrowserTab: async (name, url) => {browserName(name); const tab = tabFor(await context.newPage()); if (url !== undefined) await tab.goto(url); return tab;},
    listTabs,
    getTab: async (id, {browser: name} = {}) => {browserName(name); const tab = tabs.get(id); if (!tab) throw Error('LOCAL_CHROMIUM_TAB_NOT_FOUND'); return tab;},
    getState: async () => ({transport: 'LOCAL_CHROMIUM', tabs: await listTabs()}),
    close: () => browser.close()
  };
}
