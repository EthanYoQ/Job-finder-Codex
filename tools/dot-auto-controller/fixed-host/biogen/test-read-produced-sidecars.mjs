/** TEST_ONLY. Reads files produced by the actual owned Biogen prepare/publish path.
 * Does not create or seed any reviewed*.json output. Only the fixed root constant
 * is mapped after checking the original helper bytes against source-pins.
 */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const [target,round,selector]=process.argv.slice(2);assert.equal(process.argv.length,5);assert(path.isAbsolute(target)&&target.endsWith('/installed-disabled')&&target.includes('/lifecycle-cases/case-'));assert.match(round,/^round-[a-f0-9]{32}$/);assert.match(selector,/^[a-f0-9]{64}$/);
const pkg=path.join(target,'runtime-checkout/tools/dot-auto-controller'),profile=path.join(pkg,'fixed-host/biogen'),task=path.join(target,'rounds',round,'connector-host-task');
const hash=x=>createHash('sha256').update(x).digest('hex'),pins=JSON.parse(fs.readFileSync(path.join(profile,'source-pins.json'),'utf8'));
const raw=fs.readFileSync(path.join(profile,'fixed-recovery-helper.mts.in'),'utf8');assert.equal(hash(raw),pins.inputs['fixed-host/biogen/fixed-recovery-helper.mts.in']);assert.equal(raw.split('__JOBFINDER_FIXED_DEPLOYMENT_ROOT__').length,2);
const helper=path.join(path.dirname(target),'test-original-biogen-read-helper-'+round+'.mts');fs.writeFileSync(helper,raw.replace('__JOBFINDER_FIXED_DEPLOYMENT_ROOT__',target),{flag:'wx',mode:0o600});
const seed=JSON.parse(fs.readFileSync(path.join(task,'fixed-seed.json'),'utf8')),publication=JSON.parse(fs.readFileSync(path.join(task,'reviewed-publication-data.json'),'utf8')),projectionFile=path.join(task,'reviewed-projections.json'),projectionBytes=fs.readFileSync(projectionFile);
assert.equal(seed.sourceId,'source-biogen-china-social');assert.equal(publication.projectionsSha256,hash(projectionBytes));
function invoke(op){return spawnSync(process.execPath,['--require',path.join(pkg,'test/no-network.cjs'),'--import',path.join(pkg,'vendor/c60-source/node_modules/tsx/dist/loader.mjs'),helper,op,round],{cwd:pkg,encoding:'utf8',env:{PATH:'/usr/bin:/bin',TSX_DISABLE_CACHE:'1',JOBFINDER_CLOUD_SOURCE_ID:seed.sourceId,JOBFINDER_CONNECTOR_ROUND_ID:round,JOBFINDER_CONNECTOR_HOST_SHA256:selector,JOBFINDER_FIXED_LOCAL_MODE:'TEST_ONLY'}});}
const p=invoke('projections');assert.equal(p.status,0,p.stderr);const projected=JSON.parse(p.stdout);assert.deepEqual(projected.projections,JSON.parse(projectionBytes).projections);assert.equal(projected.projections.length,7);
const r=invoke('publication-data');assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.seed.sourceId,seed.sourceId);assert.equal(result.sqlSha256,publication.sqlSha256);assert.equal(result.recoveryDataSha256,hash(fs.readFileSync(path.join(task,'reviewed-publication-data.json'))));
// Deliberate negative mutation only in the owned synthetic case, restored exactly.
try{fs.writeFileSync(projectionFile,Buffer.concat([projectionBytes,Buffer.from('\n')]));const bad=invoke('publication-data');assert.notEqual(bad.status,0);assert(bad.stderr.includes('FIXED_PUBLICATION_PROJECTIONS'),bad.stderr);}finally{fs.writeFileSync(projectionFile,projectionBytes);}
const seedFile=path.join(task,'fixed-seed.json'),seedBytes=fs.readFileSync(seedFile);try{fs.writeFileSync(seedFile,JSON.stringify({...seed,sourceId:'source-takeda-china-social'}));const bad=invoke('publication-data');assert.notEqual(bad.status,0);assert(bad.stderr.includes('FIXED_HELPER_SEED'),bad.stderr);}finally{fs.writeFileSync(seedFile,seedBytes);}
assert.equal(invoke('publication-data').status,0);
console.log(JSON.stringify({kind:'ACTUAL_BIOGEN_PRODUCER_FILES_TO_ORIGINAL_HOST_READER',passed:true,cases:5,projections:7,prepopulatedReviewedFiles:false,helperSourceSha256:hash(raw),sameDirectory:task,publicationRequestSha256:result.requestSha256,sqlSha256:result.sqlSha256,productionQualified:false}));
