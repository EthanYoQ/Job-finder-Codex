var jnjReadDetail = async function(expected) {
const observedAt=new Date().toISOString();
const dom=await jnjRefreshTab.playwright.domSnapshot();
const data=await jnjRefreshTab.playwright.evaluate(()=>{
const root=document.querySelector('#js-job-detail');
if(!root)throw Error('Missing native job detail');
const html=root.outerHTML;
const applyLinks = [];
const observedApplyHrefs = new Set();
for (const anchor of document.querySelectorAll('a')) {
  const text = anchor.innerText.trim();
  if (text !== 'Apply now') continue;
  const style = getComputedStyle(anchor);
  if (anchor.getClientRects().length === 0 || style.visibility === 'hidden' || style.visibility === 'collapse') continue;
  const href = anchor.href;
  if (observedApplyHrefs.has(href)) continue;
  observedApplyHrefs.add(href);
  applyLinks.push({text, href});
}
return {heading:document.querySelector('h1').innerText,body:{html,htmlLength:html.length,text:root.innerText},applyLinks,check:{id:root.getAttribute('data-id'),title:root.getAttribute('data-jobtitle'),articleCount:root.querySelectorAll('article.RichTextBody').length,descriptionLength:root.querySelector('article.RichTextBody')?.innerText.length,metadata:[...root.querySelectorAll('.job-meta > li')].map(e=>e.innerText)}};
});
nodeRepl.write(JSON.stringify({kind:'BROWSER_UI_DOM_OBSERVATION_NOT_HTTP',url:await jnjRefreshTab.url(),observedAt,heading:data.heading,dom,expectedUrl:expected.url,expectedTitle:expected.title,body:data.body,applyLinks:data.applyLinks,check:data.check}));
};
