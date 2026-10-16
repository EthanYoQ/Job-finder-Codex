/** Full native pilot PRE_CAPTURE routing. Requires the fresh private runtime; no identity mocks. */
import {beforeAll,afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,readdir,readFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {initialize,configureSyntheticFixtureRuntime,fixture,priorFrom,ROOT,digest,NOW} from './viatris-synthetic-fixture.mts';
import {prepareViatrisConnectorPublicationReview} from './viatris-publication-review.mts';
import {runCloudPortableSourcePilot} from '../vendor/c60-source/scripts/p0-cloud-portable-source-pilot.ts';
const originalCwd=process.cwd();
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(()=>{process.chdir(originalCwd);vi.useRealTimers();vi.unstubAllGlobals();});
it('not-due real pilot reads original nonempty baseline once and skips before HTTP, lease or publication',async()=>{
 const first=await fixture(),gate=await prepareViatrisConnectorPublicationReview(first.input),prior=await priorFrom(first,gate.packet);
 expect(prior.jobs.length).toBeGreaterThan(0);vi.setSystemTime(Date.parse(NOW)+60_000);
 let httpCalls=0;vi.stubGlobal('fetch',async()=>{httpCalls++;throw Error('SYNTHETIC_HTTP_MUST_NOT_RUN');});
 const dir=await mkdtemp(join(tmpdir(),'viatris-pilot-due-')),relay=join(dir,'relay'),bootstrapPath=join(dir,'bootstrap.json');
 const bootstrap=JSON.stringify({schemaVersion:1,checkedAt:new Date().toISOString(),candidateRows:[first.input.scope.registration],batchId:'synthetic-not-due-batch'});await writeFile(bootstrapPath,bootstrap,{flag:'wx'});
 process.chdir(ROOT);
 const pending=runCloudPortableSourcePilot({bootstrapPath,reviewedSha256:digest(bootstrap),workspaceRoot:dir,relayDirectory:relay,dbStartedControlPath:join(dir,'unread-control.json'),overallDeadline:Date.now()+22*60_000,ownedViatrisPipe:{mode:'VIATRIS_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)}});
 let replied=false;
 for(let n=0;n<200&&!replied;n++){
  let names:string[]=[];try{names=await readdir(relay);}catch{}
  for(const name of names.filter(n=>n.endsWith('.request.json')&&names.includes(n.replace(/\.json$/,'.ready')))){
   const request=JSON.parse(await readFile(join(relay,name),'utf8'));expect(request.kind).toBe('READ_CONTEXT');expect(request.payload.purpose).toBe('PRE_CAPTURE');expect(request.payload.sourceId).toBe('source-viatris-social');
   const context={...first.input.publication.control.context,...prior,checkedAt:new Date().toISOString()};
   await writeFile(join(relay,request.requestId+'.response.json'),JSON.stringify({schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,kind:request.kind,result:context}),{flag:'wx'});replied=true;
  }
  if(!replied)await new Promise(r=>setTimeout(r,10));
 }
 expect(replied).toBe(true);expect(await pending).toMatchObject({state:'SKIPPED_NOT_DUE',sourceId:'source-viatris-social',captureStarted:false});expect(httpCalls).toBe(0);expect((await readdir(relay)).filter(n=>n.endsWith('.request.json'))).toHaveLength(1);
});
