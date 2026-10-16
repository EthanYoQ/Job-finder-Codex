/** Exact layered ancestry: 48e native contracts, 36bd UCB bridge, reviewed ea9ee four-source composition. */
import {it,expect} from 'vitest';import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {FOUR_BASE_COMMIT,FOUR_DERIVATIVE_CLASS,FOUR_SOURCE_PATHS,FOUR_BASE_HASHES,fourSourceProvenance} from '../scripts/four-source-provenance.mjs';
const pkg=path.resolve(import.meta.dirname,'..'),repo=path.resolve(pkg,'../..'),PARENT='48e56500bfe6a77ed712abfd54a98154cf963032',FOUR_REVIEWED='ea9ee259122f44fae174727187354ad059562dd5',prefix='tools/dot-auto-controller/';
const git=(args:string[])=>execFileSync('git',args,{cwd:repo,maxBuffer:8*1024*1024});
const old=(file:string,commit=PARENT)=>git(['show',commit+':'+prefix+file]),read=(file:string)=>fs.readFileSync(path.join(pkg,file)),sha=(bytes:any)=>createHash('sha256').update(bytes).digest('hex');
it.each(['vendor/c60-source/src/crawler/officialJsonSourceFetch.ts','vendor/c60-source/src/crawler/ucbOfficialPostedDate.ts','vendor/c60-source/src/crawler/phenomOfficialPostedDate.ts','vendor/c60-source/src/crawler/sourceQualityAdmission.ts','vendor/c60-source/src/crawler/sourcePlan.ts','vendor/c60-source/src/crawler/companyRecruitmentProfiles/profiles/ucb-china.ts','vendor/c60-source/src/crawler/artifactArchive.ts','vendor/c60-source/src/crawler/runtimeAtomicEvidence.ts','vendor/c60-source/src/db/ingestionRepository.ts','vendor/c60-source/src/db/cloudPilotSqlControl.ts','config/native-catalog.json'])('preserves exact original 48e parent bytes: %s',file=>{expect(read(file).equals(old(file))).toBe(true);});
it('retains the real 48e to 36bd to reviewed ea9ee ancestor chain',()=>{
 expect(FOUR_BASE_COMMIT).toBe('36bd3c5a6052159cac47609bbc58750012b74eb0');
 for(const [before,after]of [[PARENT,FOUR_BASE_COMMIT],[FOUR_BASE_COMMIT,FOUR_REVIEWED],[FOUR_REVIEWED,'HEAD']])git(['merge-base','--is-ancestor',before,after]);
});
it.each(['fixed-host/sequence/build-functions-entry.py','vendor/c60-source/ops/cloud-pilot-host/connector-host-binding.mjs','vendor/c60-source/ops/cloud-pilot-host/connector-host-launch.py'])('preserves exact reviewed four-source derivative bytes: %s',file=>{expect(read(file).equals(old(file,FOUR_REVIEWED))).toBe(true);});
function filesUnder(dir:string):string[]{return fs.readdirSync(path.join(pkg,dir),{withFileTypes:true}).flatMap(entry=>{const rel=dir+'/'+entry.name;expect(entry.isSymbolicLink()).toBe(false);return entry.isDirectory()?filesUnder(rel):[rel];}).sort();}
it.each(['fixed-host/ucb','public-verification/ucb'])('preserves the complete reviewed UCB fixed UI file set and bytes: %s',dir=>{
 const expected=git(['ls-tree','-r','--name-only',FOUR_REVIEWED,'--',prefix+dir+'/']).toString().trim().split('\n').map(file=>file.slice(prefix.length)).sort();
 expect(expected.length).toBeGreaterThan(0);expect(filesUnder(dir)).toEqual(expected);
 for(const file of expected)expect(read(file).equals(old(file,FOUR_REVIEWED)),file).toBe(true);
});
it('retains default-disabled UCB entry and prohibits all three historical native stubs',()=>{
 for(const file of ['native/ucb-packet-gate.mjs','native/ucb-reader-gate.mjs','native/ucb-offline-adapter.mjs'])expect(fs.existsSync(path.join(pkg,file))).toBe(false);
 const first=read('fixed-host/ucb/functions-entry.js').toString().split('\n')[0],match=/^const ACTIVATION=Object\.freeze\((.*)\);$/.exec(first);expect(match).not.toBeNull();
 expect(JSON.parse(match![1])).toEqual({enabled:false,mode:'LIVE',deploymentSha256:'0'.repeat(64)});
});
const baseManifest=JSON.parse(old('vendor/C60_SOURCE_MANIFEST.json',FOUR_BASE_COMMIT).toString()),manifest=JSON.parse(read('vendor/C60_SOURCE_MANIFEST.json').toString());
const records=manifest.files.filter((file:any)=>file.classification===FOUR_DERIVATIVE_CLASS);
it('binds both four-source layout derivatives to full 36bd ancestry and original exporter validation',()=>{
 expect(records.map((file:any)=>file.path).sort()).toEqual([...FOUR_SOURCE_PATHS].sort());
 const exported=JSON.parse(execFileSync(process.execPath,[path.join(pkg,'scripts/package-manifest.mjs')],{cwd:pkg,maxBuffer:8*1024*1024}).toString());
 for(const file of records){const prior=baseManifest.files.find((entry:any)=>entry.path===file.path),baseBytes=old('vendor/c60-source/'+file.path,FOUR_BASE_COMMIT),bytes=read('vendor/c60-source/'+file.path);
  expect(file.priorProvenance).toEqual(prior);expect(file.derivativeBaseCommit).toBe(FOUR_BASE_COMMIT);expect(file.derivativeBaseSha256).toBe(sha(baseBytes));expect(Object.entries(FOUR_BASE_HASHES)).toContainEqual([file.path,file.derivativeBaseSha256]);expect(prior.sha256).toBe(sha(baseBytes));expect(prior.bytes).toBe(baseBytes.length);
  expect(file.originCommit).toBeNull();expect(file.originSha256).toBeUndefined();expect(file.ancestorOriginCommit).toBeUndefined();expect(file.productionQualified).toBe(false);expect(file.sha256).toBe(sha(bytes));expect(file.bytes).toBe(bytes.length);
  const provenance=fourSourceProvenance(file);expect(provenance).not.toBeNull();expect(provenance!.originCommit).toBeNull();expect(provenance!.productionQualified).toBe(false);expect(provenance!.newBuildQualificationRequired).toBe(true);
  expect(exported.entries.find((entry:any)=>entry.path===prefix+'vendor/c60-source/'+file.path).provenance).toEqual(provenance);
 }
});
it.each(['wrong-base','wrong-base-hash','truncated-prior','historical-origin','qualified'])('original four-source validator rejects %s without weakening ancestry',kind=>{
 expect(records).toHaveLength(2);for(const original of records){const file=structuredClone(original);if(kind==='wrong-base')file.derivativeBaseCommit=PARENT;if(kind==='wrong-base-hash')file.derivativeBaseSha256='0'.repeat(64);if(kind==='truncated-prior')delete file.priorProvenance.priorProvenance;if(kind==='historical-origin')file.originCommit=PARENT;if(kind==='qualified')file.productionQualified=true;expect(()=>fourSourceProvenance(file)).toThrow();}
});
it('retains existing three source owned method bytes while adding independent UCB methods',()=>{const file='vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts',before=old(file).toString(),after=fs.readFileSync(path.join(pkg,file),'utf8');for(const [name,next]of [['Takeda','Biogen'],['Biogen','Hengrui'],['Hengrui','Ucb']]){const start='  async prepareOwned'+name+'Publish(';const prevEnd=name==='Hengrui'?'  sql(':'  async prepareOwned'+next+'Publish(';const beforeMethods=before.slice(before.indexOf(start),before.indexOf(prevEnd,before.indexOf(start)));const afterMethods=after.slice(after.indexOf(start),after.indexOf('  async prepareOwned'+next+'Publish(',after.indexOf(start)));expect(afterMethods).toBe(beforeMethods);}});
