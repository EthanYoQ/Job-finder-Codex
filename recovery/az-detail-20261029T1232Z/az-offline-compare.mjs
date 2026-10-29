import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';
const b=process.cwd(),c=path.join(b,'recovery104-work/az-detail-geography-candidate-20261029T1232Z'),v='tools/dot-auto-controller/vendor/c60-source';
const old=await import(path.join(b,'five-source-sequence-source-candidate-20261016T1235Z',v,'src/crawler/astraZenecaDetails.ts'));
const next=await import(path.join(c,v,'src/crawler/astraZenecaDetails.ts'));
const {azPlan}=await import(path.join(c,v,'tests/helpers/astrazeneca.ts'));
const {replayAstraZenecaList}=await import(path.join(c,v,'src/crawler/astraZenecaDetailAcquisition.ts'));
const r=path.join(b,'takeda-original-recovery-20261017T0417Z/astrazeneca/dot-auto-astrazeneca-20261029T122508696Z/artifacts');const files=fs.readdirSync(r),d=JSON.parse(fs.readFileSync(path.join(r,files.find(x=>x.endsWith('.astrazeneca-evidence.json'))))),a=JSON.parse(fs.readFileSync(path.join(r,files.find(x=>x.endsWith('.archive.json')))));
const bodies=new Map(a.sidecar.artifacts.map(x=>{const f=a.files.find(f=>f.path===x.path),body=Buffer.from(f.chunks.join(''),'base64');assert.equal(crypto.createHash('sha256').update(body).digest('hex'),f.sha256);return [x.logicalKey,body]}));
const ev={...d.evidence,artifacts:d.evidence.artifacts.filter(x=>d.evidence.astraZenecaDetails.listArtifactLogicalKeys.includes(x.logicalKey)).map(x=>({...x,body:bodies.get(x.logicalKey).toString()}))};delete ev.astraZenecaDetails;
const jobs=replayAstraZenecaList(azPlan(),ev,d.capturedAt,false),changes=[];let same=0;
for(const row of jobs){const e=d.evidence.astraZenecaDetails.entries.find(e=>e.sourceJobId===row.sourceJobId),body=bodies.get(e.artifactLogicalKey).toString(),app=e.applicationArtifactLogicalKey?{...d.evidence.artifacts.find(x=>x.logicalKey===e.applicationArtifactLogicalKey),body:bodies.get(e.applicationArtifactLogicalKey)}:undefined;
 if(app)delete app.binary;
 let before;try{before=old.parseAstraZenecaDetail(body,row,app)}catch(err){before={error:err.message}}
 const after=next.parseAstraZenecaDetail(body,row,app);if(before.error)changes.push({id:row.sourceJobId,before,after});else{assert.deepEqual(after,before);same++;}}
assert.equal(same,322);assert.equal(changes.length,5);assert(changes.every(x=>x.after.locationStatus==='CITY_PENDING'&&x.after.scopeReviewCodes.length===0));
const result={batch:a.sidecar.batchId,total:jobs.length,unchanged:same,changes};fs.writeFileSync(path.join(c,'AZ_OFFLINE_RESULT.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({total:jobs.length,unchanged:same,changed:changes.map(x=>({id:x.id,before:x.before,status:x.after.locationStatus}))},null,2));
