'use strict';
// NONQUALIFYING synthetic browser-serialization regression tests. No source access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const readiness=require('../../diagnostics/jnj-delayed-scope-20261006T052730Z/list-readiness-proposal.cjs');
const sourceBefore=fs.readFileSync(path.join(__dirname,'strict-list-before.js'),'utf8');
const sourceFixed=fs.readFileSync(path.join(__dirname,'strict-list-fixed.js'),'utf8');
const url='https://www.careers.jnj.com/en/jobs/?country=China&origin=global#results';
const heading='Displaying 1 to 20 of 106 matching jobs';
const rawHtml='<ul id="js-job-search-results" data-results="106">SYNTHETIC NONQUALIFYING BODY</ul>';
const dom='SYNTHETIC NONQUALIFYING DOM\n- option "China" [selected]\n- searchbox "Keywords"\n- heading "'+heading+'"';
const children=Array.from({length:20},(_,i)=>({innerText:'SYNTHETIC ONLY '+i,getAttribute:()=> 'r-'+(900000+i),querySelectorAll:()=>[{innerText:'SYNTHETIC ONLY '+i,href:'https://www.careers.jnj.com/en/jobs/r-'+(900000+i)+'/synthetic-only/'}]}));
const filters=['team','subteam','country','state','location','type','pattern'].map(name=>({id:'l-'+name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}));
const links=[{label:'Page 1',href:url,text:'1'},{label:'Page 6',href:'https://www.careers.jnj.com/en/jobs/?page=6&country=China&origin=global#results',text:'6'},{label:'Next page',href:'https://www.careers.jnj.com/en/jobs/?page=2&country=China&origin=global#results',text:''}].map(a=>({href:a.href,innerText:a.text,getAttribute:()=>a.label}));
const root={outerHTML:rawHtml,children,getAttribute:()=> '106'};
const doc={URL:url,querySelector:()=>root,querySelectorAll:s=>s==='h2'?[{innerText:heading}]:s==='select'?filters:links};
function serializeRepeatedReferences(value){const seen=new WeakSet();return JSON.parse(JSON.stringify(value,(k,v)=>{if(v&&typeof v==='object'){if(seen.has(v))return '[Circular]';seen.add(v);}return v;}));}
async function run(source,forceCorruption=false){
 const out=[];const tab={playwright:{domSnapshot:async()=>dom,getByRole:()=>({evaluate:async fn=>{const result=serializeRepeatedReferences(fn({value:'',ownerDocument:doc}));if(forceCorruption)result.fragment.items[0].links='[Circular]';return result;}})}};
 const sandbox={jnjReadinessHelpers:readiness,nodeRepl:{write:s=>out.push(JSON.parse(s))}};vm.createContext(sandbox);vm.runInContext(source,sandbox);await sandbox.jnjReadListStrict(tab,1,106);return out;
}
(async()=>{
 const before=await run(sourceBefore);assert.equal(before[0].fragment.items[0].links,'[Circular]');
 const fixed=await run(sourceFixed);assert.equal(fixed.length,1);assert.equal(fixed[0].fragment.items.length,20);assert.ok(fixed[0].fragment.items.every(x=>Array.isArray(x.links)&&x.links.length===1));assert.ok(!JSON.stringify(fixed[0]).includes('[Circular]'));assert.equal(fixed[0].fragment.html,rawHtml);assert.equal(fixed[0].dom,dom);
 await assert.rejects(()=>run(sourceFixed,true),/LIST_CAPTURE_FRAGMENT_LINK_SCHEMA/);
 const report={kind:'NONQUALIFYING_SYNTHETIC_SERIALIZATION_REGRESSION',qualifyingCapture:false,browserCalls:0,sourceNavigation:false,passed:3,cases:['Before change reproduces repeated-reference Circular marker','Independent link copies survive serialization and preserve full DOM/HTML','Post-evaluate fragment schema guard rejects a corrupted link field before emitting any formal JSON'],sourceSha256:crypto.createHash('sha256').update(sourceFixed).digest('hex')};
 fs.writeFileSync(path.join(__dirname,'NONQUALIFYING-serialization-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
