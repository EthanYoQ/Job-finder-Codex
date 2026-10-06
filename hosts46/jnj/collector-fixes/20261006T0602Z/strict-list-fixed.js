var jnjReadListStrict = async function(tab, page, expectedTotal) {
const observedAt=new Date().toISOString();
const dom=await tab.playwright.domSnapshot();
const sampled=await tab.playwright.getByRole('searchbox',{name:'Keywords',exact:true}).evaluate(keyword=>{
 const doc=keyword.ownerDocument;
 const root=doc.querySelector('#js-job-search-results');
 if(!root)throw Error('Missing native list');
 const html=root.outerHTML;
 const heading=[...doc.querySelectorAll('h2')].find(e=>e.innerText.startsWith('Displaying')).innerText;
 const filters=[...doc.querySelectorAll('select')].map(e=>({id:e.id,name:e.name,selectedOptions:[...e.selectedOptions].map(o=>({text:o.text,value:o.value}))}));
 const pagination=[...doc.querySelectorAll('nav[aria-label="Pagination"] a')].map(a=>({label:a.getAttribute('aria-label'),url:a.href,text:a.innerText}));
 const items=[...root.children].map(li=>({text:li.innerText,links:[...li.querySelectorAll('a.js-view-job')].map(a=>({title:a.innerText,url:a.href}))}));
 const identities=[...root.children].map((li,index)=>({officialId:li.getAttribute('data-id'),links:items[index].links.map(link=>({title:link.title,url:link.url}))}));
 return {state:{keyword:keyword.value,url:doc.URL,heading,filters,resultCount:root.getAttribute('data-results'),identities,pagination},fragment:{html,htmlLength:html.length,items}};
});
if(!Array.isArray(sampled.fragment.items)||sampled.fragment.items.some(item=>!Array.isArray(item.links)||item.links.length!==1||typeof item.links[0].title!=='string'||typeof item.links[0].url!=='string'))throw Error('LIST_CAPTURE_FRAGMENT_LINK_SCHEMA');
const check=jnjReadinessHelpers.checkListReadiness(sampled.state,page,expectedTotal);
if(!check.ready)throw Error('LIST_CAPTURE_SCOPE_REJECTED '+JSON.stringify(check));
if(!dom.includes('option "China" [selected]')||!dom.includes(sampled.state.heading)||!/searchbox "Keywords"(?:\r?\n|$)/.test(dom))throw Error('LIST_CAPTURE_DOM_SCOPE_MISMATCH');
nodeRepl.write(JSON.stringify({kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:sampled.state.url,observedAt,heading:sampled.state.heading,dom,fragment:sampled.fragment,filters:sampled.state.filters,pagination:sampled.state.pagination}));
};