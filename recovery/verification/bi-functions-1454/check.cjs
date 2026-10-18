const fs=require('fs'),assert=require('assert/strict');
const A=Object.getPrototypeOf(async function(){}).constructor;
(async()=>{const jobs=JSON.parse(fs.readFileSync('bi-http-ui-feasibility-20261018T1440Z/ui/bi-jobs.json')).jobs;
let saved,closed=0;const rows=jobs.map(j=>({href:j.href,cells:['',j.title,j.job_number,j.location,j.published_at],visible:j.visible,html:'fixture'}));
const tools={mcp__cua_repl__js:async({code})=>{let o={started:true};if(code.includes('evaluateAll'))o={captured_at:new Date().toISOString(),source_url:'https://campus.51job.com/BI/recruitSociety.html',rows};if(code.includes('.close()'))closed++;return {content:[{type:'text',text:'BI_DOM_RESULT:'+JSON.stringify(o)}]};},apply_patch:async p=>{saved=p;return {};}};
const {captureBiDom}=await new A('tools',fs.readFileSync('inactive-bi-functions-20261018T1444Z/bi-functions.js','utf8'))(tools);
const r=await captureBiDom({directory:'/unused',deadline:Date.now()+60000});assert.equal(r.jobs.length,50);assert.equal(new Set(r.jobs.map(j=>j.jobId)).size,50);assert(saved.includes('dom-capture.json'));assert.equal(closed,1);rows[0].href='https://example.com/BI/recruit_article_detail3.html?jobId=1';await assert.rejects(captureBiDom({directory:'/unused',deadline:Date.now()+60000}),/BI_DOM_JOB_IDENTITY/);assert.equal(closed,2);console.log('PASS current 50 DOM rows; wrong origin rejected; own tab closed');})();
