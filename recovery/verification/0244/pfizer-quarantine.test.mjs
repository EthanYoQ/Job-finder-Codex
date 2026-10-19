import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const nativeRoot=process.env.PFIZER_SOURCE_ROOT??new URL('../source/',import.meta.url).pathname;
const {pfizerDomListSlots}=await import(pathToFileURL(join(nativeRoot,'src/crawler/pfizerRenderedTraversal.ts')).href);
const source=await readFile(new URL('./pfizer-browser-runtime.js',import.meta.url),'utf8');
// Entirely synthetic list page; no retained official HTML, titles or paths.
const country='6cb77610a8a543aea2d6bc10457e35d4',entry='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers';
const ids=Array.from({length:20},(_,i)=>i===1?'4965522':String(4965501+i));
const cards=ids.filter(id=>id!=='4965522').map(id=>({href:`${entry}/job/China---Synthetic---City/Synthetic_Control_${id}?Location_Country=${country}`,title:`Synthetic control ${id}`}));
const original={url:`${entry}?Location_Country=${country}`,title:'Search for Jobs',countryFilter:'China clear filter',filterCount:1,searchText:'',pageLabel:'Page 3 of 11',range:'41 - 60 of 209 jobs',totalText:'209 JOBS FOUND',nextControlPresent:true,capturedAt:'2026-10-19T01:52:01.208Z',cards,
 domSnapshot:'- region "Search Results":\n  - list "Page 3 of 11":\n'+ids.map(id=>{const card=cards.find(c=>c.href.includes('_'+id+'?'));return(card?`    - heading "${card.title}" [level=3]:\n      - link "${card.title}":\n        - /url: ${card.href}\n`:'')+`    - list:\n      - listitem: "${id}"`;}).join('\n')+'\n  - navigation "pagination":'};
const create=page=>{
 const detailUrls=[];let detailUrl='';
 const control=(value={})=>({first(){return this;},filter(){return this;},waitFor:async()=>{},click:async()=>{},count:async()=>1,isVisible:async()=>true,isEnabled:async()=>true,...value});
 const list={url:async()=>page.url,title:async()=>page.title,getAXState:async()=>{},close:async()=>{},playwright:{domSnapshot:async()=>page.domSnapshot,
  locator:selector=>control({getAttribute:async()=>page.pageLabel,innerText:async()=>selector.includes('jobOutOfText')?page.range:page.totalText,evaluateAll:async()=>page.cards}),
  getByRole:(_role,{name})=>control({getAttribute:async()=>page.countryFilter,innerText:async()=>`Clear All (${page.filterCount})`,evaluate:async()=>page.searchText})}};
 const detail={goto:async url=>{detailUrl=url;detailUrls.push(url);},url:async()=>detailUrl,title:async()=>page.cards.find(c=>c.href===detailUrl)?.title,getAXState:async()=>{},close:async()=>{},playwright:{domSnapshot:async()=>'Synthetic test detail',getByRole:()=>control(),
  locator:selector=>control({innerText:async()=>selector.includes('requisitionId')?/_(\d{7})(?:-\d+)?$/.exec(new URL(detailUrl).pathname)[1]:page.cards.find(c=>c.href===detailUrl).title,
   allTextContents:async()=>selector.startsWith('script')?['{"@type":"JobPosting"}']:['Synthetic location']})}};
 let count=0;const cua={createBrowserTab:async()=>count++===0?list:detail};
 // Expose the private pure parser only to this offline test. Production exports are unchanged.
 const runtime=new Function('cua',source.replace('return {start,readPage,advance,close};','return {start,readPage,advance,close,listSlots};')+'\nreturn pfizerDomRuntime;')(cua);
 return {runtime,detailUrls};
};
const {runtime,detailUrls}=create(original);
assert.deepEqual(runtime.listSlots(original),pfizerDomListSlots(original));
await runtime.start(Date.now()+60_000);await runtime.advance();await runtime.advance();
const packet=await runtime.readPage();
assert.equal(packet.failure,undefined);assert.equal(packet.rows.length,20);assert.equal(detailUrls.length,19);
assert.deepEqual(packet.rows[1],{officialId:'4965522',quarantineCode:'PFIZER_LIST_ROW_UNKNOWN',noOmissionVerified:false,domRow:'- list:\n      - listitem: "4965522"',capturedAt:packet.listPage.capturedAt});
assert(detailUrls.every(url=>!url.includes('4965522')));
await assert.rejects(runtime.readPage(),/DUPLICATE/);
for(const alter of [p=>p.cards.pop(),p=>{p.domSnapshot=p.domSnapshot.replace('listitem: "4965522"','listitem: "4965523"');},p=>{p.domSnapshot=p.domSnapshot.replace('    - list:\n      - listitem: "4965522"','');}]){
 const changed=structuredClone(original);alter(changed);const {runtime:r}=create(changed);
 assert.throws(()=>r.listSlots(changed));assert.throws(()=>pfizerDomListSlots(changed));
}
console.log(JSON.stringify({offline:true,sourcePage:3,rawSlots:20,fullDetailReads:19,unknownId:'4965522',unknownDetailReads:0,parsersAgree:true,unreviewedMissingRejected:true}));
