import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const base=dirname(dirname(fileURLToPath(import.meta.url))),host=join(base,'hosts46/astra'),repo=join(base,'producer42');
assert.equal(process.env.JOBFINDER_CLOUD_SOURCE_ID,'source-astrazeneca-social');
for(const k of ['TSX_DISABLE_CACHE','NODE_DISABLE_COMPILE_CACHE','PYTHONDONTWRITEBYTECODE'])assert.equal(process.env[k],'1');
const denyNetwork=async()=>{throw Error('OFFLINE_ONLY');};globalThis.fetch=denyNetwork;
const imp=p=>import(pathToFileURL(join(repo,p)).href);
const {azPlan,azRow,azDetail,azListCapture,azResponse,AZ_NOW}=await imp('tests/helpers/astrazeneca.ts');
const {acquireAstraZenecaDetails,replayAstraZenecaDetails}=await imp('src/crawler/astraZenecaDetailAcquisition.ts');
const {runSourceCrawl}=await imp('src/crawler/runSourceCrawl.ts');
const plan=azPlan();assert.deepEqual(JSON.parse(await readFile(join(host,'source-plan.json'))),plan);
const checks=[],rows=[azRow(),azRow('101318921472','Global Study Lead','江苏 无锡市')],captured=await azListCapture(rows),calls=[];
globalThis.fetch=async url=>{calls.push(url);const row=rows.find(r=>r.officialUrl===url);assert.ok(row);return azResponse(url,row===rows[0]?'not found':azDetail(row),row===rows[0]?404:200);};
let unavailable;try{unavailable=await acquireAstraZenecaDetails(plan,captured.fetched);}finally{globalThis.fetch=denyNetwork;}
assert.deepEqual([...calls].sort(),rows.map(r=>r.officialUrl).sort());
assert.equal(unavailable.fetchEvidence.astraZenecaDetails.entries.length,2);
const unavailableReplay=replayAstraZenecaDetails(plan,unavailable.fetchEvidence,AZ_NOW,true);
assert.equal(unavailableReplay.detailComplete,false);assert.equal(unavailableReplay.jobs.length,2);
assert.deepEqual(unavailableReplay.jobs[0].cities,['城市待核']);assert.equal(unavailableReplay.jobs[0].evidence.astraZenecaDetail.status,'UNRESOLVED');
const artifact404=unavailable.fetchEvidence.artifacts.find(a=>a.httpStatus===404);
assert.ok(artifact404);assert.equal(artifact404.requestedUrl,rows[0].officialUrl);
const body404=typeof artifact404.body==='string'?artifact404.body:Buffer.from(artifact404.body).toString('utf8');assert.equal(body404,'not found');
const rejected=await runSourceCrawl(plan,{fetch:async()=>unavailable,isBaseline:false});
assert.equal(rejected.truth.completenessVerified,false);
checks.push({check:'Synthetic 404 keeps exact body, source row and unresolved city; does not assert full detail completeness or close the job',passed:true,bodySha256:createHash('sha256').update(body404).digest('hex')});
globalThis.fetch=async url=>{const row=rows.find(r=>r.officialUrl===url);assert.ok(row);return azResponse(url,azDetail(row));};
let complete;try{complete=await acquireAstraZenecaDetails(plan,captured.fetched);}finally{globalThis.fetch=denyNetwork;}
assert.equal(replayAstraZenecaDetails(plan,complete.fetchEvidence,AZ_NOW,false).detailComplete,true);
for(const [name,mutate] of [
 ['omitted detail',e=>e.astraZenecaDetails.entries.pop()],
 ['duplicate detail',e=>e.astraZenecaDetails.entries[1]=e.astraZenecaDetails.entries[0]],
 ['forged city',e=>e.astraZenecaDetails.entries[0].outcome.evidence.cities=['北京']],
 ['missing artifact',e=>e.artifacts.pop()],
 ['redirected detail',e=>e.artifacts[1].finalUrl=rows[1].officialUrl]
]){const tampered=structuredClone(complete.fetchEvidence);mutate(tampered);assert.throws(()=>replayAstraZenecaDetails(plan,tampered,AZ_NOW,false));checks.push({check:'Per-job binding rejects '+name,passed:true});}
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,purpose:'SYNTHETIC_LOCAL_404_AND_PER_JOB_BOUNDARY_ONLY_NOT_QUALIFYING',sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false,checks};
await writeFile(join(host,'DETAIL_BOUNDARY_CHECKS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
