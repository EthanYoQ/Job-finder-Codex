/** SQL extraction and receipt-to-UI checks without DB or external calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const entry=fs.readFileSync(new URL('./functions-entry.js',import.meta.url),'utf8');
const body=fs.readFileSync(new URL('./body.template.js',import.meta.url),'utf8');
const compiler=JSON.parse(entry.match(/^const READ_OUTCOME_COMPILER=(.*);$/m)[1]);
const query=new Function('tuple',compiler);
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const check=(ok,code)=>{if(!ok)throw Error(code);};
test('compiler is pinned original Viatris SELECT and escapes original tuple only',()=>{
  assert.equal(sha(compiler),'9e0c909bc5a31d1f37e9a112c9d7b28e875b189f2ec27b7a6114c7a30f168442');
  const sql=query({sourceResultId:"result'\\",batchId:"batch'\\"});
  assert(sql.includes("WHERE id=E'result''\\\\'"));assert(sql.includes("WHERE id=E'batch''\\\\'"));
  assert(sql.includes("WHERE id='formal-crawl'"));assert(!/\b(INSERT|UPDATE|DELETE)\b/.test(sql));
});
const fieldLine=body.match(/const members=receipt\.members\.filter[^\n]+/)[0];
const jobsLine=body.match(/const jobs=members\.map[^\n]+/)[0];
const extract=new Function('receipt','projectionData','SOURCE','check','own','sha','canonical',fieldLine+'\n'+jobsLine+'\nreturn jobs;');
const projection={companyId:'company-viatris',sourceId:'source-viatris-social',dedupeKey:'synthetic-key',sourceJobId:'RAW-position-007',officialTitle:'Original Tupu title',officialUrl:'https://careersite.tupu360.com/Viatris/position/detail?positionId=007',listUrl:'https://careersite.tupu360.com/Viatris/position/index?recruitmentType=SOCIALRECRUITMENT',locationRaw:'上海',city:'上海',cities:['上海'],officialPublishedAt:null,missingSuccessCount:0,lifecycleStatus:'ACTIVE',visibleInFrontend:true,isNew:true};
const receiptFor=p=>({members:[{setKind:'VISIBLE',jobKey:p.dedupeKey,jobProjectionSha256:sha(canonical({schemaVersion:'job-persisted-projection-v1',projection:p}))}]});
const run=(p,r=receiptFor(p))=>extract(r,{projections:[p]},'source-viatris-social',check,(o,k)=>Object.hasOwn(o,k),sha,canonical);
test('receipt-backed projection preserves raw position ID, official URL and title',()=>{
  assert.deepEqual(run(projection),[{sourceJobId:projection.sourceJobId,officialTitle:projection.officialTitle,officialUrl:projection.officialUrl}]);
});
test('matching member hash cannot authorize another source or company projection',()=>{
  for(const p of [{...projection,sourceId:'source-ucb-china-social'},{...projection,companyId:'company-ucb-china'}])
    assert.throws(()=>run(p),/UI_PROJECTION_RECEIPT_HASH/);
});
test('changed raw ID, title or URL fails original full member projection hash',()=>{
  for(const key of ['sourceJobId','officialTitle','officialUrl'])
    assert.throws(()=>run({...projection,[key]:'changed'},receiptFor(projection)),/UI_PROJECTION_RECEIPT_HASH/);
});
test('missing or duplicate visible projection cannot manufacture an expected job',()=>{
  const r=receiptFor(projection);
  for(const projections of [[],[projection,projection]])
    assert.throws(()=>extract(r,{projections},'source-viatris-social',check,(o,k)=>Object.hasOwn(o,k),sha,canonical),/UI_MEMBER_UNIQUE/);
});
