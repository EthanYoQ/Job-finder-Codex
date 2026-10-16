/** Full native compiler and local gate replay. Git registration is synthetic. */
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
const provenance=vi.hoisted(()=>({deployment:{} as any,route:{} as any}));
vi.mock('../src/biogen-deployment.mjs',()=>({loadDeployment:()=>provenance.deployment,assertDeploymentBinding:()=>{},deploymentBindingSha256:()=> 'synthetic-binding'}));
vi.mock('../src/biogen-catalog.mjs',()=>({loadCatalog:()=>({sources:{biogen:provenance.route}})}));
import {canonical,sha} from '../src/journal.mjs';

import {writeFile,mkdir,cp,rm,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
vi.mock('node:child_process',async(importOriginal)=>{const actual=await importOriginal<any>();return {...actual,execFileSync:(cmd:string,args:string[],options:any)=>{if(cmd==='git'&&options?.cwd?.endsWith('/vendor/c60-source')){if(args.join(' ')==='status --porcelain')return '';if(args.join(' ')==='rev-parse HEAD')return 'd02f4f5ea35a4c4c1564b52fbd5a80fcb5b84b9f';throw Error('UNEXPECTED_SYNTHETIC_GIT_QUERY');}throw Error('OFFLINE_CHILD_EXEC_FORBIDDEN');}};});
import {prepareDbStartedCloudPublicationReplay} from '../vendor/c60-source/src/db/ingestionRepository.ts';
import {reviewBiogenPacket} from '../native/biogen-packet-gate.mts';
import {projectBiogenApi} from '../native/biogen-api-gate.mts';
import {candidateCompanies} from '../vendor/reader-main/src/data/companyRegistry.ts';
import {searchPortableSnapshot,coverageFromPortableSnapshot} from '../vendor/reader-main/src/server/portablePublicationApi.ts';
import {replayBiogenReaders} from '../native/biogen-reader-gate.mts';
import {fixture,request,initialize,configureSyntheticFixtureRuntime,dirs} from '../connector-gate/biogen-synthetic-fixture.mts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
it('compiles complete native packet and replays original atomic SQL twice without DB',async()=>{
 const f=await fixture(),prepared=await prepareDbStartedCloudPublicationReplay(f.input.publication),packet=prepared.packet;expect(await prepared.recompile()).toEqual(packet);
 expect(packet.sql).toContain('PILOT_V75_FENCE_FUNCTION_DRIFT');expect(packet.sql).toContain('PILOT_V75_FENCE_TRIGGER_DRIFT');expect(packet.sql).toContain('FROM public."_prisma_migrations") <> 50');expect(packet.sql).toContain('20261014141000_v75_retired_candidate_fence');expect(packet.sql).toContain('6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7');
 for(const code of ['CRAWL_LEASE_BUSY','PILOT_CONTEXT_CHANGED','PILOT_CANDIDATE_DRIFT'])expect(packet.sql).toContain(code);
 const authority=await mkdtemp(join(tmpdir(),'biogen-full-review-'));dirs.push(authority);const host=join(authority,'biogen');await mkdir(host);const run=join(host,f.input.publication.source.batchId),out=join(run,'review');for(const d of [run,out,join(run,'relay'),join(run,'diagnostics')])await mkdir(d);
 const write=(p:string,v:any)=>writeFile(p,JSON.stringify(v));const control=f.input.publication.control,source=f.input.publication.source;
 await write(join(host,'host-config.json'),{sourceId:source.plan.source.id,sourceConfigSha256:source.pending.sourceConfigHash});await write(join(host,'control-base.json'),control);await write(join(host,'activation.json'),{status:'REGISTERED_VERIFIED',candidate:control.candidate,build:control.build});await write(join(host,'expected-candidate.json'),f.input.scope.registration);await write(join(host,'source-config-reference.json'),{currentSourcePlan:source.plan});await write(join(run,'bootstrap.json'),{checkedAt:control.context.checkedAt});
 await cp(f.input.archive.originalRoot,join(run,'artifacts'),{recursive:true});await cp(f.input.archive.bundlePath,join(run,'artifacts',source.batchId+'.archive.json'));
 provenance.route={sourceId:source.plan.source.id,projectId:'yiopvxysxrtrnvqxwgbx'};
 const identity={schemaVersion:1,kind:'DURABLE_AUTO_AUTHORITY_V1',sourceId:provenance.route.sourceId,projectId:provenance.route.projectId};await write(join(authority,'authority-identity.json'),identity);provenance.deployment={activated:true,authorityDirectory:authority,authorityIdentitySha256:sha(JSON.stringify(identity))};
 for(const d of ['controller/runs/'+source.batchId,'controller/source-claims','transport'])await mkdir(join(authority,d),{recursive:true});
 const journal=async(key:string,value:any)=>write(join(authority,'controller/runs',source.batchId,key+'.json'),{schemaVersion:1,runId:source.batchId,key,value,valueSha256:sha(canonical(value))});
 await journal('00-run',{schemaVersion:1,batchId:source.batchId,sourceId:provenance.route.sourceId,startedAt:f.input.outerDeadline-1800000,outerDeadline:f.input.outerDeadline,routeIdentitySha256:sha(canonical(provenance.route)),deploymentBindingSha256:'synthetic-binding'});
 await journal('01-source-claim',{sourceId:provenance.route.sourceId});await journal('20-original-launch',{batchId:source.batchId,sourceId:provenance.route.sourceId,originalDeadline:f.input.outerDeadline,deploymentBindingSha256:'synthetic-binding'});
 await writeFile(join(run,'diagnostics/process.jsonl'),JSON.stringify({event:'WRAPPER_START',outerDeadline:f.input.outerDeadline})+'\n');
 const r=request(packet);await write(join(run,'relay',r.requestId+'.request.json'),r);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),r.payload.sql);
 const lines=source.artifacts.flatMap((a:any,i:number)=>[{event:'REQUEST_START',requestId:String(i),timeoutMs:45000,url:{origin:'https://biibhr.wd3.myworkdayjobs.com'},recordedAt:a.capturedAt},{event:'HEADERS_RECEIVED',requestId:String(i),status:200,timeoutMs:45000,url:{origin:'https://biibhr.wd3.myworkdayjobs.com'},recordedAt:a.capturedAt}]);await writeFile(join(run,'diagnostics/http-requests.jsonl'),lines.map((v:any)=>JSON.stringify(v)).join('\n'));
 const checked=await reviewBiogenPacket(run,r.requestId,join(out,'packet-review.json'),{originalOuterDeadline:f.input.outerDeadline});expect(checked.review.counts.current).toBe(7);
 await expect(reviewBiogenPacket(run,r.requestId,join(out,'spoofed-deadline.json'),{originalOuterDeadline:f.input.outerDeadline+1})).rejects.toThrow('BIOGEN_ORIGINAL_DEADLINE_PROVENANCE');
 // Original journal provenance is checked even when a caller supplies matching data.
 const launchValue={batchId:source.batchId,sourceId:provenance.route.sourceId,originalDeadline:f.input.outerDeadline,deploymentBindingSha256:'synthetic-binding'};
 await journal('20-original-launch',{...launchValue,originalDeadline:f.input.outerDeadline+60000});
 await expect(reviewBiogenPacket(run,r.requestId,join(out,'changed-launch.json'),{originalOuterDeadline:f.input.outerDeadline+60000})).rejects.toThrow('BIOGEN_ORIGINAL_RUN_BINDING');await journal('20-original-launch',launchValue);
 await writeFile(join(run,'diagnostics/process.jsonl'),[1,2].map(()=>JSON.stringify({event:'WRAPPER_START',outerDeadline:f.input.outerDeadline})).join('\n'));
 await expect(reviewBiogenPacket(run,r.requestId,join(out,'duplicate-wrapper.json'),{originalOuterDeadline:f.input.outerDeadline})).rejects.toThrow('BIOGEN_ORIGINAL_WRAPPER_DEADLINE');await writeFile(join(run,'diagnostics/process.jsonl'),JSON.stringify({event:'WRAPPER_START',outerDeadline:f.input.outerDeadline})+'\n');
 const originalDirectory=provenance.deployment.authorityDirectory;provenance.deployment.authorityDirectory=host;
 await expect(reviewBiogenPacket(run,r.requestId,join(out,'wrong-authority.json'),{originalOuterDeadline:f.input.outerDeadline})).rejects.toThrow();provenance.deployment.authorityDirectory=originalDirectory;
 const before={sourceId:source.plan.source.id,sourceConfigSha256:source.pending.sourceConfigHash,checkedAt:control.context.checkedAt,transactionReadOnly:'on',isolationLevel:'repeatable read',publicationContext:control.context,jobs:[],results:[],members:[],artifacts:[],writerInventory:[],inventory:Object.fromEntries(['jobs','results','members','artifacts'].map(k=>[k,{count:0,ids:[]}]))};
 const readers=await replayBiogenReaders({run,outputDirectory:out,before,packet:checked});expect(readers.main).toEqual(readers.fallback);expect(readers.main.after.jobs).toHaveLength(7);
 const projectApi=async(...args:Parameters<typeof projectBiogenApi>)=>{vi.setSystemTime(Date.now()+61000);return projectBiogenApi(...args);};
 // The real two native readers start with no accepted receipt: real search is absent.
 const snapshot=(projected:any)=>({sources:[projected],companies:[{id:source.plan.company.id,companyName:source.plan.company.officialChineseName,pinyin:candidateCompanies.find(c=>c.id===source.plan.company.id)!.pinyinName,category:'FOREIGN_PHARMA',required:true,publishingSourceIds:projected.state==='PUBLISHING'?[source.plan.source.id]:[],sourceIds:[source.plan.source.id],health:projected.state==='PUBLISHING'?projected.health:projected.health==='DEGRADED'?'DEGRADED':'UNVERIFIED',jobs:projected.state==='PUBLISHING'?projected.jobs:[]}],coverage:{requiredCompanyCount:1,excludedCompanyCount:0},lastUpdatedAt:projected.state==='PUBLISHING'?projected.lastSuccessAt:null}) as any;
 const publicState=(snap:any)=>({search:searchPortableSnapshot({city:'全部城市',limit:50,offset:0},snap),coverage:coverageFromPortableSnapshot({keyword:'',limit:41,offset:0},snap)});
 const emptyPublic=publicState(snapshot(readers.main.before));expect(emptyPublic.search.companies).toEqual([]);expect(emptyPublic.coverage.companies[0].state).toBe('VERIFYING');
 const first=await projectApi(emptyPublic,out,source.batchId);expect(first.expected.before).toBeNull();expect(first.expected.after.jobs).toHaveLength(7);expect(first.result.delta.addedIds.slice().sort()).toEqual(readers.main.after.jobs.map((j:any)=>j.id).sort());expect(first.result.delta.removedIds).toEqual([]);expect(first.result.delta.changedJobs).toEqual([]);expect(first.result.delta.addedJobs).toEqual(first.expected.after.jobs);expect(first.expected.beforeRequestCases.find((c:any)=>c.name==='target_company').expected.companies).toEqual([]);expect(first.expected.afterRequestCases).toHaveLength(9);
 // Missing scope/excluded source and a forged before-company remain closed.
 const missing=structuredClone(emptyPublic);missing.coverage.companies=[];await expect(projectApi(missing,out,source.batchId)).rejects.toThrow('BIOGEN_REQUIRED_COVERAGE_COMPANY_MISSING');
 const excluded=structuredClone(emptyPublic);excluded.coverage.companies[0].state='USER_AUTHORIZED_PHASE1_EXCLUSION';await expect(projectApi(excluded,out,source.batchId)).rejects.toThrow('BIOGEN_SOURCE_OUTSIDE_REQUIRED_SCOPE');
 const forged=structuredClone(emptyPublic);forged.search.companies=[first.expected.after];await expect(projectApi(forged,out,source.batchId)).rejects.toThrow('BEFORE_READER_TO_PUBLIC_SEARCH_COMPANY');
 // A reader with no selected after receipt cannot be promoted just to create an empty company.
 for(const name of ['main','fallback'])await write(join(out,'reader-diagnostic-'+name+'.json'),{before:readers.main.before,after:readers.main.before});await expect(projectApi(emptyPublic,out,source.batchId)).rejects.toThrow();
 // Existing published state remains supported and keeps an empty ID delta.
 for(const name of ['main','fallback'])await write(join(out,'reader-diagnostic-'+name+'.json'),{before:readers.main.after,after:readers.main.after});
 const beforePublic=publicState(snapshot(readers.main.after));const api=await projectApi(beforePublic,out,source.batchId);expect(api.result.delta.addedJobs).toHaveLength(0);expect(api.expected.after.jobs.filter((j:any)=>j.cities.includes('城市待核'))).toHaveLength(3);
 // Zero-job API semantics: publishing coverage remains, search omits the company.
 // This is projection-boundary input only, not a new packet qualification.
 const zero={...readers.main.after,jobs:[],visibleJobCount:0};for(const name of ['main','fallback'])await write(join(out,'reader-diagnostic-'+name+'.json'),{before:zero,after:zero});
 const zeroApi=await projectApi(publicState(snapshot(zero)),out,source.batchId);expect(zeroApi.expected.before).toBeNull();expect(zeroApi.expected.after).toBeNull();expect(zeroApi.expected.afterCoverage.state).toBe('PUBLISHING');expect(zeroApi.result.delta.addedIds).toEqual([]);expect(zeroApi.expected.afterAggregate.totalJobs).toBe(0);
 // Reader disagreement is not hidden by absent public companies.
 await write(join(out,'reader-diagnostic-fallback.json'),{before:zero,after:readers.main.after});await expect(projectApi(publicState(snapshot(zero)),out,source.batchId)).rejects.toThrow('MAIN_AND_FALLBACK_API_PROJECTIONS_MUST_MATCH');
 // Independent audit regression: rehashed SQL/request cannot renew original evidence at +31m.
 const oldNow=Date.now(),extended=structuredClone(r),later='2026-10-11T11:00:00.000Z';extended.payload.sql=extended.payload.sql.split(extended.expiresAt).join(later);extended.expiresAt=later;extended.payload.dispatchBefore='2026-10-11T10:57:15.000Z';const {requestSha256:ignored,...extendedBody}=extended;extended.requestSha256=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(extendedBody)).digest('hex');await write(join(run,'relay',r.requestId+'.request.json'),extended);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),extended.payload.sql);vi.setSystemTime(oldNow+31*60_000);await expect(reviewBiogenPacket(run,r.requestId,join(out,'negative-extended-expiry.json'),{originalOuterDeadline:f.input.outerDeadline})).rejects.toThrow('BIOGEN_ORIGINAL_EVIDENCE_EXPIRY_EXTENDED');vi.setSystemTime(oldNow);await write(join(run,'relay',r.requestId+'.request.json'),r);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),r.payload.sql);
 // Full packet rejects extra SQL and expired original request; neither creates a new packet.
 for(const kind of ['sql tail','expired']){const bad=structuredClone(r);if(kind==='sql tail')bad.payload.sql+='\nSELECT 1;';else bad.expiresAt=new Date(Date.now()-1).toISOString();const {requestSha256,...body}=bad;bad.requestSha256=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(body)).digest('hex');await write(join(run,'relay',r.requestId+'.request.json'),bad);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),bad.payload.sql);await expect(reviewBiogenPacket(run,r.requestId,join(out,'negative-'+kind+'.json'),{originalOuterDeadline:f.input.outerDeadline})).rejects.toThrow();}
 await write(join(run,'relay',r.requestId+'.request.json'),r);await writeFile(join(run,'relay',r.requestId+'.request.json.sql'),r.payload.sql);
 for(const kind of ['inventory','source','missing member']){const bad=structuredClone(before),badPacket=structuredClone(checked),negative=join(run,'negative-'+kind);await mkdir(negative);if(kind==='inventory')bad.inventory.jobs.count=1;else if(kind==='source')bad.sourceId='source-takeda-china-social';else badPacket.decoded.receipt.members.pop();await expect(replayBiogenReaders({run,outputDirectory:negative,before:bad,packet:badPacket})).rejects.toThrow();}

});
