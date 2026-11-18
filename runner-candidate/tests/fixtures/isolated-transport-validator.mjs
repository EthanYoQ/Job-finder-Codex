import {fetchWithOfficialTimeout} from '../../src/crawler/officialHttpRuntimeLimits.ts';
import {createViatrisBrowserTraversalValidation} from '../../src/crawler/traversalCertificate.ts';
import {EventEmitter} from 'node:events';
import {createChromiumDom} from '../../src/crawler/local-browser/chromium-dom.mjs';

export async function runBGradeIndependentTraversalValidator(input) {
  const mode=new URL(input.entryUrl).searchParams.get('mode');
  if(mode==='browser-failure') {
    const context=new EventEmitter();context.pages=()=>[];
    const browser=await createChromiumDom({chromium:{launch:async()=>({newContext:async()=>context,close:async()=>{}})}});
    const frame={page:()=>({mainFrame:()=>frame})};
    context.emit('response',{url:()=>input.entryUrl,status:()=>429,headers:()=>({'retry-after':'7200'}),
      frame:()=>frame,request:()=>({isNavigationRequest:()=>true,resourceType:()=>'document'})});
    await browser.close();
  } else {
    await fetchWithOfficialTimeout('https://careers.example.test/synthetic',{}, {
      fetchImpl:async()=>new Response('PRIVATE_SYNTHETIC_RESPONSE_BODY',{status:503,headers:{'retry-after':'7200'}})
    });
  }
  if(mode==='hang')await new Promise(()=>setInterval(()=>{},1000));
  if(mode!=='success')throw Error('synthetic rendered control unavailable');
  const observedAt=new Date().toISOString();
  return createViatrisBrowserTraversalValidation({sourceConfigSha256:input.sourceConfigSha256,
    surfaceIds:input.surfaceIds,channelIds:input.channelIds,
    pages:[{pageNumber:1,declaredTotalPages:1,sourceJobIds:['synthetic-job'],nextControlPresent:false}],
    observedAt,expiresAt:new Date(Date.now()+60_000).toISOString()});
}
