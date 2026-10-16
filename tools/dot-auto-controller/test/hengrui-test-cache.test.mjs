import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {hengruiTestCacheDir,requireExternalHengruiTestCache} from './hengrui-test-cache.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('both Hengrui Vitest suites select isolated cache directories outside source',()=>{
 for(const suite of ['native','connector']){const cache=hengruiTestCacheDir(suite);assert(path.isAbsolute(cache));assert.equal(requireExternalHengruiTestCache(cache),cache);assert(cache.includes('-'+suite+'-cache-'));}
 assert.notEqual(hengruiTestCacheDir('native'),hengruiTestCacheDir('connector'));
 for(const [rel,suite]of [['test/hengrui.vitest.config.mts','native'],['connector-gate/hengrui.vitest.config.mts','connector']]){const s=fs.readFileSync(path.join(root,rel),'utf8');assert(s.includes("cacheDir:hengruiTestCacheDir('"+suite+"')"));assert(!s.includes("cacheDir:'.hengrui"));}
});
test('test cache cannot target source itself, any source child or traversed child',()=>{for(const value of [root,path.join(root,'cache'),path.join(root,'test','..','cache')])assert.throws(()=>requireExternalHengruiTestCache(value),/OUTSIDE_SOURCE/);assert.throws(()=>hengruiTestCacheDir('arbitrary'),/CACHE_SUITE/);});
test('actual external test cache bytes never enter source export',()=>{
 const cache=hengruiTestCacheDir('connector');fs.mkdirSync(cache,{recursive:true});const sentinel=path.join(cache,'source-export-sentinel-'+Date.now()+'.json');fs.writeFileSync(sentinel,'{"kind":"TEST_ONLY_EXTERNAL_CACHE"}',{flag:'wx'});
 const manifest=JSON.parse(execFileSync(process.execPath,[path.join(root,'scripts/package-manifest.mjs')],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));assert(!manifest.entries.some(e=>e.path.includes(path.basename(sentinel))||e.path.includes('jobfinder-hengrui-connector-cache-')));
 assert.equal(fs.readFileSync(sentinel,'utf8'),'{"kind":"TEST_ONLY_EXTERNAL_CACHE"}');
});
