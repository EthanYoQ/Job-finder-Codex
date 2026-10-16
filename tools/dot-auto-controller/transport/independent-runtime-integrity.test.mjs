import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createExistingCompiler,HISTORICAL_C60_BUILD} from './existing-compiler.mjs';
const sourceId='source-takeda-china-social',sourceConfigSha256='048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f';
test('unverified root code cannot attest itself or execute before trusted integrity verification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compiler-integrity-review-'));
 const previous=process.env.JOBFINDER_CLOUD_SOURCE_ID;process.env.JOBFINDER_CLOUD_SOURCE_ID=sourceId;
 try{
  await mkdir(join(root,'scripts'),{recursive:true});await mkdir(join(root,'src','readiness'),{recursive:true});await mkdir(join(root,'src','db'),{recursive:true});
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  const lock='review-only synthetic lock';
  await writeFile(join(root,'package-lock.json'),lock);
  for(const dir of ['.git/objects','.git/refs','dist','prisma','ops','node_modules'])await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'.git','HEAD'),HISTORICAL_C60_BUILD.commitSha+'\n');
  for(const file of ['tsconfig.json','Dockerfile','.dockerignore','index.html','vite.config.ts','testExecutionContract.ts'])await writeFile(join(root,file),'');
  await writeFile(join(root,'scripts','verify-node-runtime-profile.ts'),'export const verifyNodeRuntimeProfile=async()=>({});');
  await writeFile(join(root,'src','readiness','buildIdentity.ts'),`export const createBuildIdentity=()=>(${JSON.stringify(HISTORICAL_C60_BUILD)});`);
  await writeFile(join(root,'src','db','ingestionRepository.ts'),"globalThis.__reviewUnverifiedImportExecuted=true; export const compileDbStartedCloudSourcePublication=async()=>({sql:'SELECT 42',atomic:true});");
  await writeFile(join(root,'src','db','cloudPilotSqlControl.ts'),`export const CLOUD_PILOT_SOURCE=${JSON.stringify({id:sourceId,sourceConfigSha256})}; export const compileCloudPilotPublicationContextSql=()=>\"SELECT 'unverified compiler accepted'\";`);
  let rejected=false;
  try{await createExistingCompiler({runtimeRoot:root,expectedBuild:HISTORICAL_C60_BUILD,expectedLockSha256:createHash('sha256').update(lock).digest('hex'),expectedSourceId:sourceId,expectedSourceConfigSha256:sourceConfigSha256});}catch{rejected=true;}
  assert.deepEqual({unverifiedModuleExecuted:globalThis.__reviewUnverifiedImportExecuted===true,factoryRejected:rejected},{unverifiedModuleExecuted:false,factoryRejected:true},'Unverified root code must not execute or attest itself.');
 }finally{delete globalThis.__reviewUnverifiedImportExecuted;if(previous===undefined)delete process.env.JOBFINDER_CLOUD_SOURCE_ID;else process.env.JOBFINDER_CLOUD_SOURCE_ID=previous;await rm(root,{recursive:true,force:true});}
});
