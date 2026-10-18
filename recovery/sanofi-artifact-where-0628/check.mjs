import fs from 'node:fs';import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('./after/original-portable-reader-replay.mts',import.meta.url),'utf8');const raw=s.match(/where\.OR\.some\(\(q:any\)=>(.*?)\)\)\.map/)[1];const match=new Function('a','q','return '+raw);
const q={releaseCandidateId:'r',batchId:'b',sourceResultId:'x',sourceId:'s'},a={...q,extractorLocator:'one'};
assert(match(a,q));assert(match({...a,extractorLocator:'two'},q));assert(match(a,{...q,extractorLocator:{in:['one']}}));assert(!match(a,{...q,extractorLocator:{in:['two']}}));for(const k of Object.keys(q))assert(!match({...a,[k]:'wrong'},q));console.log('PASS compact whole tuple and legacy locator restriction; four identity mismatches rejected');
