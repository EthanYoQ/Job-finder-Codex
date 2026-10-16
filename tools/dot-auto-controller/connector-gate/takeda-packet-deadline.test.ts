/** Full native compiler and local gate replay. Git registration is synthetic. */
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {writeFile,mkdir,cp,rm,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<any>();return {...actual,execFileSync:(cmd:string,args:string[],options:any)=>{if(cmd==='git'&&options?.cwd?.endsWith('/vendor/c60-source')){if(args.join(' ')==='status --porcelain')return '';if(args.join(' ')==='rev-parse HEAD')return 'd02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f';throw Error('UNEXPECTED_SYNTHETIC_GIT_QUERY');}throw Error('OFFLINE_CHILD_EXEC_FORBIDDEN');}};});
import {prepareDbStartedCloudPublicationReplay} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {reviewTakedaPacket} from '../native/takeda-packet-gate.mts';
import {fixture,request,initialize,configureSyntheticFixtureRuntime,dirs} from './takeda-packet-fixture.mts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('Takeda rejects re-dated SQL/request after original evidence cutoff',async()=>{
 const f=await fixture(),prepared=await prepareDbStartedCloudPublicationReplay(f.input.publication),packet=prepared.packet;expect(await prepared.recompile()).toEqual(packet);
 for(const code of ['CRAWL_LEASE_BUSY','PILOT_CONTEXT_CHANGED','PILOT_CANDIDATE_DRIFT'])expect(packet.sql).toContain(code);
 const host=await mkdtemp(join(tmpdir(),'takeda-packet-deadline-'));dirs.push(host);const run=join(host,f.input.publication.source.batchId),out=join(run,'review');for(const d of [run,out,join(run,'relay'),join(run,'diagnostics')])await mkdir(d);
 const write=(p:string,v:any)=>writeFile(p,JSON.stringify(v));const control=f.input.publication.control,source=f.input.publication.source;
 await write(join(host,'host-config.json'),{sourceId:source.plan.source.id,sourceConfigSha256:source.pending.sourceConfigHash});await write(join(host,'control-base.json'),control);await write(join(host,'activation.json'),{status:'REGISTERED_VERIFIED',candidate:control.candidate,build:control.build});await write(join(host,'expected-candidate.json'),f.input.scope.registration);await write(join(host,'source-config-reference.json'),{currentSourcePlan:source.plan});await write(join(run,'bootstrap.json'),{checkedAt:control.context.checkedAt});
 await cp(f.input.archive.originalRoot,join(run,'artifacts'),{recursive:true});await cp(f.input.archive.bundlePath,join(run,'artifacts',source.batchId+'.archive.json'));
 const r=request(packet);await write(join(run,'relay',r.requestId+'.request.json'),r);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),r.payload.sql);
 const lines=source.artifacts.flatMap((a:any,i:number)=>[{event:'REQUEST_START',requestId:String(i),timeoutMs:45000,url:{origin:'https://jobs.takeda.com'},recordedAt:a.capturedAt},{event:'HEADERS_RECEIVED',requestId:String(i),status:200,timeoutMs:45000,url:{origin:'https://jobs.takeda.com'},recordedAt:a.capturedAt}]);await writeFile(join(run,'diagnostics/http-requests.jsonl'),lines.map((v:any)=>JSON.stringify(v)).join('\n'));

 const limits={outerDeadline:f.input.outerDeadline,publicationDeadline:f.input.publication.publicationDeadline!};
 const checked=await (reviewTakedaPacket as any)(run,r.requestId,join(out,'valid.json'),limits).catch(async(e:any)=>{console.log(await (await import('node:fs/promises')).readFile(join(out,'valid.json.request-error.json'),'utf8').catch(()=>''));throw e;});expect(checked.review.counts.current).toBe(2);
 const extended=structuredClone(r),expiry='2026-10-11T11:00:00.000Z';
 extended.payload.sql=extended.payload.sql.split(extended.expiresAt).join(expiry);extended.expiresAt=expiry;extended.payload.dispatchBefore='2026-10-11T10:57:15.000Z';
 const {requestSha256:oldHash,...body}=extended;extended.requestSha256=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(body)).digest('hex');
 await write(join(run,'relay',r.requestId+'.request.json'),extended);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),extended.payload.sql);vi.setSystemTime(Date.now()+31*60_000);
 await expect((reviewTakedaPacket as any)(run,r.requestId,join(out,'extended.json'),limits)).rejects.toThrow();
});

import {verifyTakedaPublicationWindow} from '../native/takeda-publication-window.mts';
import {PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
const t=Date.parse('2026-10-11T10:00:00.000Z');
function timing(){return {terminal:{startedAt:new Date(t).toISOString(),completenessCertificate:{legacyCertificate:{schemaVersion:'plan-bound-source-quality-v1',acquisition:{finishedAt:new Date(t+60000).toISOString()}}}},limits:{outerDeadline:t+22*60000,publicationDeadline:t+20*60000},request:{expiresAt:new Date(t+20*60000).toISOString(),payload:{dispatchBefore:new Date(t+20*60000-PILOT_BUDGET.publishDbMs-PILOT_BUDGET.publishTransportMs).toISOString()}}};}
it('uses original acquisition finish, never delta-wrapper fallback or review clock',()=>{const f=timing();expect(verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000).evidenceExpiry).toBe(t+31*60000);});
it('rejects original evidence extension independently of outer budget',()=>{const f=timing();f.limits={outerDeadline:t+62*60000,publicationDeadline:t+60*60000};f.request.expiresAt=new Date(t+32*60000).toISOString();f.request.payload.dispatchBefore=new Date(t+32*60000-165000).toISOString();expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000)).toThrow('TAKEDA_PUBLICATION_EXPIRY_EXTENDED');});
it('rejects publication cutoff extension even while evidence is fresh',()=>{const f=timing();f.limits.publicationDeadline-=1;expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000)).toThrow('TAKEDA_PUBLICATION_EXPIRY_EXTENDED');});
it('preserves two original control budgets before outer deadline',()=>{const f=timing();f.limits.outerDeadline-=1;expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000)).toThrow('TAKEDA_ORIGINAL_OUTER_DEADLINE_REQUIRED');});
it('rejects dispatch windows with one millisecond less DB/transport reserve',()=>{const f=timing();f.request.payload.dispatchBefore=new Date(Date.parse(f.request.payload.dispatchBefore)+1).toISOString();expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000)).toThrow('TAKEDA_ORIGINAL_DISPATCH_BUDGET_REQUIRED');});
it('allows shortened original expiry but never at or beyond its dispatch cutoff',()=>{const f=timing();f.request.expiresAt=new Date(t+10*60000).toISOString();const cutoff=t+10*60000-165000;f.request.payload.dispatchBefore=new Date(cutoff).toISOString();expect(verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,cutoff-1).expiresAt).toBe(t+10*60000);expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,cutoff)).toThrow('TAKEDA_ORIGINAL_PUBLICATION_WINDOW_EXPIRED');});
it('rejects missing/malformed time authority',()=>{for(const change of [(f:any)=>f.limits.outerDeadline=NaN,(f:any)=>f.limits.publicationDeadline=Infinity,(f:any)=>f.terminal.completenessCertificate.legacyCertificate.acquisition.finishedAt='invalid',(f:any)=>f.terminal.startedAt='invalid',(f:any)=>f.request.expiresAt='invalid']){const f=timing();change(f);expect(()=>verifyTakedaPublicationWindow(f.request,f.terminal,f.limits,t+60000)).toThrow();}});
