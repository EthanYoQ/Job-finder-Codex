import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import fs from 'node:fs';
// Independent dependency fixture for the proposed query. This is NOT PostgreSQL execution.
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const seed={CrawlBatch:[{id:'shared',tuple:'b1'}],CrawlBatchSourceResult:[{id:'ra',batchId:'shared',sourceId:'A',tuple:'ra1'},{id:'rb',batchId:'shared',sourceId:'B',tuple:'rb1'}],CrawlObservation:[],EvidenceArtifact:[],TransportAttemptEvidence:[],PaginationEvidence:[],LossLedgerEntry:[],LifecycleSetEvidenceMember:[],Job:[{id:'ja',sourceId:'A',tuple:'ja1'}]};
function versions(data){const results=new Map(data.CrawlBatchSourceResult.map(r=>[r.id,r])),group={A:[],B:[],C:[]};for(const[table,rows]of Object.entries(data))for(const row of rows){let sources;if(table==='CrawlBatch')sources=data.CrawlBatchSourceResult.filter(r=>r.batchId===row.id).map(r=>r.sourceId);else if(['Job','CrawlBatchSourceResult'].includes(table))sources=[row.sourceId];else sources=[row.sourceId,results.get(row.sourceResultId)?.sourceId];for(const source of new Set(sources))if(group[source])group[source].push(table+'/'+row.tuple);}return {...Object.fromEntries(Object.entries(group).map(([key,tuples])=>[key,hash(tuples.sort())])),NOVO:hash(data)};}
const baseline=versions(seed),cases=[];function test(name,mutate,expected){const data=structuredClone(seed);mutate(data);const next=versions(data),changed=Object.keys(next).filter(k=>next[k]!==baseline[k]).sort();assert.deepEqual(changed,[...expected,'NOVO'].sort(),name);cases.push({name,changed,pass:true});}
test('shared batch update invalidates both sources',d=>d.CrawlBatch[0].tuple='b2',['A','B']);
test('wrong-source observation invalidates direct and owner',d=>d.CrawlObservation.push({sourceId:'B',sourceResultId:'ra',tuple:'o1'}),['A','B']);
test('wrong-source artifact invalidates direct and owner',d=>d.EvidenceArtifact.push({sourceId:'C',sourceResultId:'ra',tuple:'a1'}),['A','C']);
test('null-source observation retains owner',d=>d.CrawlObservation.push({sourceId:null,sourceResultId:'ra',tuple:'o1'}),['A']);
test('Job source migration invalidates both sides',d=>{d.Job[0].sourceId='B';d.Job[0].tuple='j2';},['A','B']);
test('deleting last Job invalidates old source',d=>d.Job=[],['A']);
test('off-roster closure dependency still invalidates Novo',d=>d.EvidenceArtifact.push({sourceId:'OUTSIDE',sourceResultId:'missing',tuple:'outside1'}),[]);
const out={pass:true,scope:'INDEPENDENT_OWNERSHIP_MODEL_NOT_SQL_EXECUTION',cases};fs.writeFileSync('inactive-source-cache-20261027T0857Z/OWNERSHIP_MODEL_RESULT.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
