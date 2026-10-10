import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Executes the actual builtin bootstrap with deliberately inert dependencies.
// The stub compiler records its entry cwd and stops before any runtime import,
// credential provider, database connection, reader, authority or mutation action.
test('bootstrap binds the original producer working directory before runtime modules load',()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'jobfinder-bootstrap-cwd-'));
 try{
  for(const dir of ['native','src','transport','config','vendor/producer','launch'])fs.mkdirSync(path.join(fixture,dir),{recursive:true});
  const producer=path.join(fixture,'vendor/producer');
  fs.writeFileSync(path.join(producer,'package-lock.json'),'{}\n');
  fs.writeFileSync(path.join(fixture,'config/deployment.json'),'{}\n');
  const write=(name,body)=>fs.writeFileSync(path.join(fixture,name),body);
  write('src/catalog.mjs',`export const PACKAGE_ROOT=${JSON.stringify(fixture)};export function loadCatalog(){return {sources:{takeda:{producer:${JSON.stringify(producer)},configured:true,enabled:true,sourceId:'source-takeda-china-social',sourceConfigSha256:'a'.repeat(64),candidate:{id:'offline-fixture-only'},build:{}}}};}`);
  write('src/deployment.mjs',`export function loadDeployment(){return {};}export function assertDeploymentBinding(){return true;}`);
  write('src/authority.mjs',`export function requireAuthority(){globalThis.authorityChecked=true;}`);
  write('src/mutation-fence.mjs',`export function createMutationFence(){return {revoke(){},markMutationAttempt(){throw Error('UNEXPECTED_MUTATION');},async sealTerminal(){}};}`);
  write('src/reader-pin-binding.mjs',`export function combinedReaderPins(){throw Error('UNEXPECTED_READER');}`);
  write('src/control-plane.mjs',`export function createControlPlane(){throw Error('UNEXPECTED_CONTROL');}`);
  write('transport/pg-connection.mjs',`export function createPgConnectionFactory(){throw Error('UNEXPECTED_DATABASE');}`);
  write('transport/existing-compiler.mjs',`import fs from 'node:fs';export async function createExistingCompiler(options){fs.writeFileSync(${JSON.stringify(path.join(fixture,'observed.json'))},JSON.stringify({cwd:process.cwd(),runtimeRoot:options.runtimeRoot,authorityChecked:globalThis.authorityChecked}));throw Error('EXPECTED_STOP_BEFORE_RUNTIME_IMPORT');}`);
  const bootstrap=fs.readFileSync(new URL('../native/takeda-bootstrap.mjs',import.meta.url),'utf8');
  write('native/takeda-bootstrap.mjs',bootstrap);
  const guard=new URL('./no-network.cjs',import.meta.url);
  const result=spawnSync(process.execPath,['--require',guard.pathname,path.join(fixture,'native/takeda-bootstrap.mjs')],{cwd:path.join(fixture,'launch'),env:{PATH:process.env.PATH,JOBFINDER_CLOUD_SOURCE_ID:'source-takeda-china-social'},encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.signal,null);
  const observed=JSON.parse(fs.readFileSync(path.join(fixture,'observed.json'),'utf8'));
  assert.equal(observed.authorityChecked,true);
  assert.equal(observed.runtimeRoot,producer);
  assert.equal(observed.cwd,producer,'native runtime modules must resolve process.cwd() to the attested producer root');
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
